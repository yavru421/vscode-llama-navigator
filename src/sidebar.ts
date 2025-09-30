import * as vscode from 'vscode';

// Lightweight types for sidebar & chat state
export type Role = 'user' | 'assistant' | 'system';
export interface ChatMessage {
  role: Role;
  content: string;
  timestamp?: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  history: ChatMessage[];
}

export interface Settings {
  apiUrl?: string;
  apiKey?: string;
  systemPrompt?: string;
}

/**
 * DondlingerSidebarProvider
 * - Maintains lightweight in-memory session state and communicates with a compact sidebar webview
 */
export class DondlingerSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'dondlinger.sidebarDev';
  private _view?: vscode.WebviewView;
  private sessions: Session[] = [];
  private activeSessionId: string | null = null;
  private settings: Settings = {};
  private readonly _context: vscode.ExtensionContext;

  constructor(private readonly _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._context = context;
    // rehydrate persisted state (best-effort)
    try {
      const stored = this._context.globalState.get<any>('dondlinger.sessions');
      if (Array.isArray(stored)) {this.sessions = stored as Session[];}
      const active = this._context.globalState.get<string | null>('dondlinger.activeSessionId');
      if (active) {this.activeSessionId = active;}
      const settings = this._context.globalState.get<Settings>('dondlinger.settings');
      if (settings) {this.settings = settings;}
    } catch (e) {
      console.error('Failed to rehydrate sidebar state:', e);
    }
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    this.ensureDefaultSession();
    this.postSessionList();
    this.postPluginList();
    this.postSessionHistory();
  }

  // --- Message routing ---
  private handleMessage(msg: any) {
    if (!msg || typeof msg.type !== 'string') {return;}
    if (msg.type === 'ping') {
      // reply with pong so webview knows host is reachable
      this.postNotification('pong', {});
      this.postNotification('debug', { message: 'sidebar host received ping and sent pong' });
      return;
    }
    switch (msg.type) {
      case 'saveSettings':
        this.handleSaveSettings(msg);
        break;
      case 'newSession':
        this.handleNewSession();
        break;
      case 'switchSession':
        this.handleSwitchSession(String(msg.id));
        break;
      case 'deleteSession':
        this.handleDeleteSession(String(msg.id));
        break;
      case 'fileOp':
        this.handleFileOp(msg);
        break;
      case 'sendPrompt':
        this.handleSendPrompt(String(msg.prompt || ''));
        break;
      case 'uploadImage':
        this.handleUploadImage(msg);
        break;
      case 'clearHistory':
        this.handleClearHistory();
        break;
      case 'installPlugin':
        this.handleInstallPlugin();
        break;
      case 'openHome':
        this.handleOpenHome();
        break;
      case 'openChat':
        this.handleOpenChat();
        break;
      default:
        break;
    }
  }

  // --- Handlers (kept intentionally simple) ---
  private handleSaveSettings(payload: any) {
    this.settings = {
      apiUrl: payload.apiUrl || this.settings.apiUrl,
      apiKey: payload.apiKey || this.settings.apiKey,
      systemPrompt: payload.systemPrompt || this.settings.systemPrompt,
    };
    this.postNotification('settingsSaved', { success: true });
    this.persistState();
  }

  private handleNewSession() {
    const id = this.makeId();
    const session: Session = { id, name: `Session ${this.sessions.length + 1}`, createdAt: Date.now(), history: [] };
    this.sessions.push(session);
    this.activeSessionId = id;
    this.postSessionList();
    this.postSessionHistory();
    this.persistState();
  }

  private handleSwitchSession(id: string) {
    const found = this.sessions.find((s) => s.id === id);
    if (!found) { this.postNotification('switchFailed', { reason: 'not_found', id }); return; }
    this.activeSessionId = id;
    this.postSessionList();
    this.postSessionHistory();
    this.persistState();
  }

  private handleDeleteSession(id: string) {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) { this.postNotification('deleteFailed', { reason: 'not_found', id }); return; }
    this.sessions.splice(idx, 1);
    if (this.activeSessionId === id) {this.activeSessionId = this.sessions.length ? this.sessions[0].id : null;}
    this.postSessionList();
    this.postSessionHistory();
    this.persistState();
  }

  private async handleFileOp(payload: any) {
    const opType = String(payload.opType || '');
    const filePath = String(payload.filePath || '');
    const fileContent = payload.fileContent || '';
    if (!vscode.workspace.isTrusted) {
      this.postNotification('fileOpResult', { success: false, reason: 'workspace_not_trusted', opType, filePath });
      return;
    }
    const uri = vscode.Uri.file(filePath);
    try {
      if (opType === 'read') {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString('utf-8');
        this.appendToActiveSession({ role: 'system', content: `Read file: ${filePath}` });
        this.postNotification('fileOpResult', { success: true, opType, filePath, content });
      } else if (opType === 'write') {
        const confirm = await vscode.window.showWarningMessage(`Write to ${filePath}?`, { modal: true }, 'Yes');
        if (confirm !== 'Yes') { this.postNotification('fileOpResult', { success: false, reason: 'user_cancelled', opType, filePath }); return; }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(String(fileContent), 'utf-8'));
        this.appendToActiveSession({ role: 'system', content: `Wrote file: ${filePath}` });
        this.postNotification('fileOpResult', { success: true, opType, filePath });
      } else if (opType === 'delete') {
        const confirm = await vscode.window.showWarningMessage(`Delete ${filePath}?`, { modal: true }, 'Yes');
        if (confirm !== 'Yes') { this.postNotification('fileOpResult', { success: false, reason: 'user_cancelled', opType, filePath }); return; }
        await vscode.workspace.fs.delete(uri);
        this.appendToActiveSession({ role: 'system', content: `Deleted file: ${filePath}` });
        this.postNotification('fileOpResult', { success: true, opType, filePath });
      } else if (opType === 'edit') {
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(doc.lineCount, 0));
        edit.replace(uri, fullRange, String(fileContent));
        await vscode.workspace.applyEdit(edit);
        this.appendToActiveSession({ role: 'system', content: `Edited file: ${filePath}` });
        this.postNotification('fileOpResult', { success: true, opType, filePath });
      } else {
        this.postNotification('fileOpResult', { success: false, reason: 'unknown_op', opType, filePath });
      }
    } catch (e) {
      console.error('fileOp error', e);
      this.postNotification('fileOpResult', { success: false, reason: 'exception', message: String(e), opType, filePath });
    }
    this.persistState();
  }

  private handleInstallPlugin() { this.postNotification('pluginInstallResult', { success: true }); this.postPluginList(); }

  private handleOpenHome() {
    void vscode.commands.executeCommand('dondlinger.openHome')
      .then(
        () => this.postNotification('openHomeAcknowledged', { success: true }),
        (e) => { console.error('Failed to execute dondlinger.openHome', e); this.postNotification('openHomeFailed', { success: false, error: String(e) }); }
      );
  }

  private handleOpenChat() {
    void vscode.commands.executeCommand('dondlinger.openChat')
      .then(
        () => this.postNotification('openChatAcknowledged', { success: true }),
        (e) => { console.error('Failed to execute dondlinger.openChat', e); this.postNotification('openChatFailed', { success: false, error: String(e) }); }
      );
  }

  // Chat handling here keeps sidebar thin — heavy lifting can be done by the full Chat panel below
  private async handleSendPrompt(prompt: string) {
    if (!prompt) {return;}
    this.ensureDefaultSession();
    const session = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    session.history.push({ role: 'user', content: prompt, timestamp: Date.now() });
    this.postSessionHistory();
    this.persistState();

    try {
      // The llama client is an external submodule without ambient types in this repo.
      // Tell TypeScript to ignore module resolution here; at runtime the submodule
      // will be initialized by CI or the developer (see README).
  // @ts-ignore: import declared in ambient types as 'llama-api-typescript'
  const { LlamaAPIClient } = await import('llama-api-typescript');
      const apiUrl = this.settings.apiUrl || vscode.workspace.getConfiguration().get<string>('dondlinger.apiUrl') || '';
      const apiKey = this.settings.apiKey || vscode.workspace.getConfiguration().get<string>('dondlinger.apiKey') || '';
      const client: any = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
      let assistantText = '';
      const stream = await client.chat.completions.create({
        model: 'Llama-3',
        messages: session.history.map((h) => ({ role: h.role, content: h.content })),
        max_completion_tokens: 1024,
        stream: true,
      });
      for await (const chunk of stream) {
        if (chunk?.event?.delta?.type === 'text') {
          const t = chunk.event.delta.text || '';
          assistantText += t;
          this._view?.webview.postMessage({ type: 'streamToken', token: t });
        }
      }
      session.history.push({ role: 'assistant', content: assistantText, timestamp: Date.now() });
      this.postSessionHistory();
      this.persistState();
    } catch (e) {
      console.error('Llama stream error', e);
      this.postNotification('chatError', { error: String(e) });
    }
  }

  private async handleUploadImage(payload: any) {
    // payload: { name, mime, base64 }
    const name = String(payload.name || 'uploaded_image');
    const mime = String(payload.mime || 'image/png');
    const base64 = String(payload.base64 || '');
    if (!base64) { this.postNotification('uploadFailed', { reason: 'no_data' }); return; }
    this.ensureDefaultSession();
    const session = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    // Add a short system/user note and the image content item
    session.history.push({ role: 'user', content: `Image uploaded: ${name}`, timestamp: Date.now() });
    session.history.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] as any, timestamp: Date.now() });
    this.postSessionHistory();
    this.persistState();

    try {
  // @ts-ignore: import declared in ambient types as 'llama-api-typescript'
  const { LlamaAPIClient } = await import('llama-api-typescript');
      const apiUrl = this.settings.apiUrl || vscode.workspace.getConfiguration().get<string>('dondlinger.apiUrl') || '';
      const apiKey = this.settings.apiKey || vscode.workspace.getConfiguration().get<string>('dondlinger.apiKey') || '';
      const client: any = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
      const res = await client.chat.completions.create({ model: 'Llama-4-Scout-17B-16E-Instruct-FP8', messages: session.history.map(h => ({ role: h.role, content: h.content })), max_completion_tokens: 1024, stream: false });
      if (res && res.completion_message) {
        session.history.push({ role: 'assistant', content: res.completion_message.content as any, timestamp: Date.now() });
        this.postSessionHistory();
        this.persistState();
      }
    } catch (e) {
      console.error('Image upload error', e);
      this.postNotification('uploadFailed', { reason: String(e) });
    }
  }

  private handleClearHistory() {
    const session = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    if (!session) {return;}
    session.history = [];
    this.postSessionHistory();
    this.persistState();
  }

  // --- Posting helpers ---
  private postSessionList() {
    if (!this._view) {return;}
    const html = this.sessions.map((s) => `
      <div style="margin-bottom:6px;">
        <button data-id="${s.id}" ${this.activeSessionId === s.id ? 'disabled' : ''}>${s.name}</button>
        <button data-delete-id="${s.id}" style="background:#a00;margin-left:8px;">Delete</button>
      </div>
    `).join('');
    this._view.webview.postMessage({ type: 'updateSessionList', html });
  }

  private postSessionHistory() {
    if (!this._view) {return;}
    const session = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    const history = session ? session.history : [];
    this._view.webview.postMessage({ type: 'updateSessionHistory', history });
  }

  private postPluginList() {
    if (!this._view) {return;}
    const html = `<div>Local plugins: none</div>`;
    this._view.webview.postMessage({ type: 'updatePluginList', html });
  }

  private postNotification(type: string, payload: any) { if (!this._view) {return;} this._view.webview.postMessage({ type, payload }); }

  private appendToActiveSession(msg: ChatMessage) {
    const session = this.sessions.find((s) => s.id === this.activeSessionId) || this.sessions[0];
    if (!session) {return;}
    session.history.push(Object.assign({ timestamp: Date.now() }, msg));
  }

  private persistState() {
    try {
      this._context.globalState.update('dondlinger.sessions', this.sessions);
      this._context.globalState.update('dondlinger.activeSessionId', this.activeSessionId);
      this._context.globalState.update('dondlinger.settings', this.settings);
    } catch (e) {
      console.error('Failed to persist sidebar state:', e);
    }
  }

  // --- Utilities ---
  private ensureDefaultSession() {
    if (this.sessions.length === 0) {
      const id = this.makeId();
      this.sessions.push({ id, name: 'Default', createdAt: Date.now(), history: [] });
      this.activeSessionId = id;
    }
  }

  private makeId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }

  // --- Sidebar HTML ---
  public getHtmlForWebview(webview: vscode.Webview): string {
    return `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #222; color: #e0e0e0; margin: 0; }
        #settings, #sessions, #fileops, #history, #plugins { padding: 12px; border-bottom: 1px solid #333; }
        input, button, select { margin: 4px 0; padding: 4px; border-radius: 4px; border: 1px solid #444; background: #181818; color: #e0e0e0; }
        button { background: #2d7ef7; color: #fff; font-weight: bold; border: none; cursor: pointer; }
        button:disabled { background: #555; cursor: not-allowed; }
        h3 { margin-top: 0; }
        .bubble { margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #333; display: flex; align-items: flex-start; }
        .bubble.user { background: #2d7ef7; color: #fff; }
        .bubble .avatar { margin-right: 8px; font-size: 1.3em; }
        .bubble .content { flex: 1; }
        .bubble .timestamp { margin-left: 8px; color: #aaa; font-size: 0.85em; }
      </style>
    </head>
    <body>
      <div id="nav">
        <button id="openHome" style="width:100%;margin-bottom:10px;">🏠 Home</button>
      </div>
      <div id="chatMini" style="padding:12px;border-bottom:1px solid #333;">
        <div id="chatHistoryMini" style="max-height:160px;overflow:auto;margin-bottom:8px;color:#ddd;font-size:0.9em;">(no messages)</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="chatInput" type="text" placeholder="Ask Llama..." style="flex:1;padding:6px;border-radius:6px;border:1px solid #444;background:#181818;color:#e0e0e0;">
          <button id="chatSend" style="padding:6px 10px;border-radius:6px;background:#2d7ef7;color:white;border:none;">Send</button>
          <button id="chatClear" style="padding:6px 10px;border-radius:6px;background:#a00;color:white;border:none;">Clear</button>
          <input id="sidebarImageInput" type="file" accept="image/*" style="display:none" />
          <button id="sidebarUploadBtn" title="Upload image to Llama" style="padding:6px 10px;border-radius:6px;background:#4b8e3a;color:white;border:none;margin-left:6px;">Upload Image</button>
        </div>
      </div>
      <div id="sidebarImagePreview" style="display:none;padding:8px;border-top:1px solid #333;background:#181818;">
        <img id="sidebarThumb" src="" style="max-width:140px;max-height:100px;border-radius:6px;border:1px solid #333;display:block;margin-bottom:6px;" />
        <div id="sidebarImageInfo" style="color:#ccc;margin-bottom:6px;"></div>
        <button id="sidebarConfirmUpload" style="background:#4b8e3a;color:white;padding:6px 10px;border-radius:6px;border:none;margin-right:8px;">Confirm</button>
        <button id="sidebarCancelUpload" style="background:#a00;color:white;padding:6px 10px;border-radius:6px;border:none;">Cancel</button>
      </div>
      <div id="settings">
        <h3>Settings</h3>
        <label>API URL:</label><br>
        <input type="text" id="apiUrl" placeholder="https://api.llama.com/v1/chat/completions" style="width:100%"><br>
        <label>API Key:</label><br>
        <input type="text" id="apiKey" placeholder="sk-..." style="width:100%"><br>
        <label>System Prompt:</label><br>
        <input type="text" id="systemPrompt" placeholder="You are a helpful assistant." style="width:100%"><br>
        <button id="saveSettings">Save</button>
      </div>
      <div id="sessions">
        <h3>Chat Sessions</h3>
        <div id="sessionList"></div>
        <button id="newSession">New Session</button>
      </div>
      <div id="fileops">
        <h3>File Operations</h3>
        <select id="fileOpType">
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="edit">Edit</option>
          <option value="delete">Delete</option>
        </select>
        <input type="text" id="filePath" placeholder="File path" style="width:60%">
        <input type="text" id="fileContent" placeholder="Content (for write/edit)" style="width:35%">
        <button id="runFileOp">Run</button>
      </div>
      <div id="history">
        <h3>Session History</h3>
        <div id="sessionHistory">(History will appear here)</div>
        <button id="exportChat">Export Chat</button>
      </div>
      <div id="plugins">
        <h3>Plugin Management</h3>
        <div id="pluginList">(Plugins will appear here)</div>
        <button id="installPlugin">Install Plugin</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        // Surface runtime webview errors to the sidebar UI and extension host
        window.addEventListener('error', function(ev) {
          try { var dbg = document.getElementById('chatHistoryMini'); if (dbg) dbg.innerText = 'Webview error: ' + (ev && ev.message ? ev.message : String(ev)); } catch (e) {}
          try { vscode.postMessage({ type: 'debug', message: 'sidebar webview error: ' + (ev && ev.message ? ev.message : String(ev)) }); } catch (e) {}
        });
        window.addEventListener('unhandledrejection', function(ev){ try { vscode.postMessage({ type: 'debug', message: 'sidebar unhandledrejection: ' + String(ev && ev.reason) }); } catch (e) {} });
        function post(type, payload) { vscode.postMessage(Object.assign({ type }, payload || {})); }
        document.getElementById('saveSettings').addEventListener('click', function() {
          post('saveSettings', { apiUrl: document.getElementById('apiUrl').value, apiKey: document.getElementById('apiKey').value, systemPrompt: document.getElementById('systemPrompt').value });
        });
        document.getElementById('newSession').addEventListener('click', function() { post('newSession'); });
        document.getElementById('installPlugin').addEventListener('click', function() { post('installPlugin'); });
        document.getElementById('openHome').addEventListener('click', function() { post('openHome'); });
  document.getElementById('runFileOp').addEventListener('click', function() { post('fileOp', { opType: document.getElementById('fileOpType').value, filePath: document.getElementById('filePath').value, fileContent: document.getElementById('fileContent').value }); });
  var sidebarUploadBtn = document.getElementById('sidebarUploadBtn');
  if (sidebarUploadBtn) {
    sidebarUploadBtn.addEventListener('click', function() { var input = document.getElementById('sidebarImageInput'); if (input) input.click(); });
  }
  var sidebarImageInput = document.getElementById('sidebarImageInput');
  if (sidebarImageInput) {
    sidebarImageInput.addEventListener('change', function(e){
      var files = e && e.target && e.target.files;
      var f = files && files[0];
      if(!f) return;
      var r = new FileReader();
      r.onload = function(){
        var res = r.result;
        if (typeof res !== 'string') { alert('Failed to read image'); return; }
        // show preview area
        var preview = document.getElementById('sidebarImagePreview');
        var thumb = document.getElementById('sidebarThumb');
        var info = document.getElementById('sidebarImageInfo');
        var confirm = document.getElementById('sidebarConfirmUpload');
        var cancel = document.getElementById('sidebarCancelUpload');
        if (thumb) thumb.src = res;
        if (preview) preview.style.display = 'block';
        if (info) info.innerText = 'Original size: ' + Math.round(f.size/1024) + ' KB';
  window._dondlinger_pending_image = { name: f.name, dataUrl: res };
        if (confirm) {
          confirm.onclick = function(){
            compressDataUrl(window._dondlinger_pending_image.dataUrl, 0.75, function(err, outDataUrl, bytes){
              if (err) { alert('Compression failed: ' + err); return; }
              if (info) info.innerText = info.innerText + ' → Compressed: ' + Math.round(bytes/1024) + ' KB';
              var mm = outDataUrl.match(/^data:(.+);base64,(.*)$/s);
              if (!mm) { alert('Failed to read compressed image'); return; }
              post('uploadImage', { name: window._dondlinger_pending_image.name, mime: mm[1], base64: mm[2] });
              if (preview) preview.style.display = 'none';
              window._dondlinger_pending_image = null;
            });
          };
        }
  if (cancel) cancel.onclick = function(){ if (preview) preview.style.display = 'none'; window._dondlinger_pending_image = null; };
      };
      r.readAsDataURL(f);
    });
  }

  // compressDataUrl helper for sidebar
  function compressDataUrl(dataUrl, quality, cb) {
    try {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var maxW = 1600; var maxH = 1600;
        var w = img.width; var h = img.height;
        if (w > maxW || h > maxH) {
          var ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var out = canvas.toDataURL('image/jpeg', quality);
        var base64 = out.split(',')[1] || '';
        var bytes = Math.ceil((base64.length * 3) / 4);
        cb(null, out, bytes);
      };
      img.onerror = function(){ cb('load error'); };
      img.src = dataUrl;
    } catch (e) { cb(String(e)); }
  }
        document.getElementById('exportChat').addEventListener('click', function() {
          const sessionId = localStorage.getItem('dondlingerActiveSessionId') || 'default';
          const history = localStorage.getItem('dondlingerChatHistory_' + sessionId) || '';
          const blob = new Blob([history], { type: 'text/markdown' });
          const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dondlinger-chat-' + sessionId + '.md'; a.click(); URL.revokeObjectURL(url);
        });
        document.getElementById('sessionList').addEventListener('click', function(ev) {
          const target = ev.target; if (!(target instanceof HTMLElement)) return; const id = target.getAttribute('data-id'); const deleteId = target.getAttribute('data-delete-id'); if (id) post('switchSession', { id }); if (deleteId) post('deleteSession', { id: deleteId });
        });
  function renderMarkdown(text) { if (!text) return ''; return text.replace(/\`\`\`([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>').replace(/\`([^\`]+)\`/g, '<code>$1</code>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>'); }
        function renderSessionHistoryFromArray(history) {
          const container = document.getElementById('sessionHistory'); if (!Array.isArray(history) || history.length === 0) { container.innerHTML = '(no history)'; return; }
          container.innerHTML = history.map(function(msg) { return '<div class="bubble ' + msg.role + '">' + '<span class="avatar">' + (msg.role === 'user' ? '\ud83e\uddd1' : '\ud83e\udd16') + '</span>' + '<span class="content">' + renderMarkdown(msg.content) + '</span>' + '<span class="timestamp">' + (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '') + '</span>' + '</div>'; }).join('');
        }
        window.addEventListener('message', function(event) { const msg = event.data; switch (msg.type) {
          case 'pong': try { var mini = document.getElementById('chatHistoryMini'); if (mini) mini.innerText = '(channel OK)'; } catch(e) {} break;
          case 'updateSessionList': document.getElementById('sessionList').innerHTML = msg.html || ''; break;
          case 'updateSessionHistory': renderSessionHistoryFromArray(msg.history || []); const mini = (msg.history || []).slice(-6).map(h => (h.role === 'user' ? 'You: ' : 'AI: ') + h.content).join('\n'); document.getElementById('chatHistoryMini').innerText = mini || '(no messages)'; break;
          case 'streamToken': let area = document.getElementById('streamArea'); if (!area) { area = document.createElement('div'); area.id = 'streamArea'; document.getElementById('chatHistoryMini').appendChild(area); } area.innerText = (area.innerText || '') + (msg.token || ''); break;
          case 'updatePluginList': document.getElementById('pluginList').innerHTML = msg.html || ''; break; default: break; } });
  var chatSend = document.getElementById('chatSend'); if (chatSend) chatSend.addEventListener('click', function() { var input = document.getElementById('chatInput'); var val = input && input.value || ''; if (!val) return; vscode.postMessage({ type: 'sendPrompt', prompt: val }); if (input) input.value = ''; });
  var chatClear = document.getElementById('chatClear'); if (chatClear) chatClear.addEventListener('click', function() { vscode.postMessage({ type: 'clearHistory' }); });
      </script>
    </body>
    </html>
    `;
  }
}

/**
 * Full Chat Panel (WebviewPanel)
 * - Use this when the user wants a dedicated, larger chat panel with streaming
 */
export class DondlingerChatPanel {
  public static currentPanel: DondlingerChatPanel | undefined;
  public static readonly viewType = 'dondlinger.chat';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _context: vscode.ExtensionContext;
  private settings: Settings = {};

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;
    this._panel.webview.options = { enableScripts: true, localResourceRoots: [extensionUri] };
    this._panel.onDidDispose(() => this.dispose(), null, []);
    this._panel.webview.onDidReceiveMessage((m) => this.handleMessage(m));
  }

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    if (DondlingerChatPanel.currentPanel) {
      DondlingerChatPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return DondlingerChatPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(DondlingerChatPanel.viewType, 'Dondlinger Chat', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [extensionUri] });
    DondlingerChatPanel.currentPanel = new DondlingerChatPanel(panel, extensionUri, context);
    panel.webview.html = DondlingerChatPanel.getHtmlForWebview(panel.webview);
    return DondlingerChatPanel.currentPanel;
  }

  public dispose() {
    DondlingerChatPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  private postNotification(type: string, payload: any) { this._panel.webview.postMessage({ type, payload }); }

  private async handleMessage(msg: any) {
    if (!msg || typeof msg.type !== 'string') {return;}
    switch (msg.type) {
      case 'sendPrompt':
        await this.handleSendPrompt(String(msg.prompt || ''));
        break;
      case 'saveSettings':
        this.settings = { apiUrl: msg.apiUrl || this.settings.apiUrl, apiKey: msg.apiKey || this.settings.apiKey, systemPrompt: msg.systemPrompt || this.settings.systemPrompt };
        this.postNotification('settingsSaved', { success: true });
        break;
      default:
        break;
    }
  }

  private async handleSendPrompt(prompt: string) {
    if (!prompt) {return;}
    // Echo user message locally
    this._panel.webview.postMessage({ type: 'appendMessage', message: { role: 'user', content: prompt, timestamp: Date.now() } });

    try {
  // @ts-ignore: import declared in ambient types as 'llama-api-typescript'
  const { LlamaAPIClient } = await import('llama-api-typescript');
      const apiUrl = this.settings.apiUrl || vscode.workspace.getConfiguration().get<string>('dondlinger.apiUrl') || '';
      const apiKey = this.settings.apiKey || vscode.workspace.getConfiguration().get<string>('dondlinger.apiKey') || '';
      const client: any = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
      let assistantText = '';
      const stream = await client.chat.completions.create({ model: 'Llama-3', messages: [{ role: 'user', content: prompt }], max_completion_tokens: 1024, stream: true });
      for await (const chunk of stream) {
        if (chunk?.event?.delta?.type === 'text') {
          const t = chunk.event.delta.text || '';
          assistantText += t;
          this._panel.webview.postMessage({ type: 'streamToken', token: t });
        }
      }
      this._panel.webview.postMessage({ type: 'appendMessage', message: { role: 'assistant', content: assistantText, timestamp: Date.now() } });
    } catch (e) {
      console.error('Chat panel Llama error', e);
      this.postNotification('chatError', { error: String(e) });
    }
  }

  public static getHtmlForWebview(webview: vscode.Webview) {
    return `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#111;color:#eee}
        .top{display:flex;gap:8px;padding:12px;border-bottom:1px solid #222}
        #messages{padding:12px;height:60vh;overflow:auto}
        .bubble{margin-bottom:8px;padding:10px;border-radius:8px;background:#222}
        .bubble.user{background:#0b5; color:#000}
        .input{display:flex;padding:12px;gap:8px}
        input[type=text]{flex:1;padding:8px;border-radius:6px;border:1px solid #333;background:#0f0f0f;color:#eee}
        button{padding:8px 12px;border-radius:6px;border:none;background:#2d7ef7;color:#fff}
      </style>
    </head>
    <body>
      <div class="top">
        <input id="apiUrl" type="text" placeholder="API URL" style="flex:1" />
        <input id="apiKey" type="text" placeholder="API Key" style="width:240px" />
        <button id="save">Save</button>
      </div>
      <div id="messages"></div>
      <div class="input">
        <input id="prompt" type="text" placeholder="Ask Llama..." />
        <button id="send">Send</button>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        function post(t,p){vscode.postMessage(Object.assign({type:t},p||{}))}
        const messages = document.getElementById('messages');
        function appendMessage(m){ const d=document.createElement('div'); d.className='bubble '+(m.role||''); d.innerHTML=(m.role==='user'?'<b>You</b>': '<b>AI</b>') + ' <div>'+ (m.content||'') + '</div>'; messages.appendChild(d); messages.scrollTop = messages.scrollHeight; }
        window.addEventListener('message', e=>{ const m=e.data; if(m.type==='streamToken'){ let area=document.getElementById('stream'); if(!area){ area=document.createElement('div'); area.id='stream'; messages.appendChild(area);} area.innerText=(area.innerText||'')+m.token; messages.scrollTop = messages.scrollHeight; } if(m.type==='appendMessage'){ appendMessage(m.message);} });
  var sendBtn = document.getElementById('send'); if (sendBtn) sendBtn.addEventListener('click', function(){ var p = document.getElementById('prompt'); var v = p && p.value || ''; if(!v) return; post('sendPrompt',{prompt:v}); if(p) p.value=''; });
  var saveBtn = document.getElementById('save'); if (saveBtn) saveBtn.addEventListener('click', function(){ var a = document.getElementById('apiUrl'); var k = document.getElementById('apiKey'); post('saveSettings',{ apiUrl: a && a.value || '', apiKey: k && k.value || '' }); });
      </script>
    </body>
    </html>`;
  }
}

