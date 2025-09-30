// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as jsYaml from 'js-yaml';
import * as vscode from 'vscode';
// Note: llama-api-typescript is included as a submodule. We import it dynamically
// at runtime so the extension can function when the submodule is initialized.
// Avoid static/relative imports that TypeScript/Node cannot resolve in this repo layout.
// Types for the external package are declared in src/types/llama-submodule.d.ts
// (LlamaAPIClient and Message are treated as any via ambient declarations).
import { DondlingerSidebarProvider } from './sidebar';

export function activate(context: vscode.ExtensionContext) {
	// --- APT m_2: Home Page Webview Command ---
	context.subscriptions.push(
		vscode.commands.registerCommand('dondlinger.openHome', () => {
			const panel = vscode.window.createWebviewPanel(
				'dondlingerHome',
				'Dondlinger Home',
				vscode.ViewColumn.One,
				{ enableScripts: true }
			);
			panel.webview.html = getDondlingerHomeHtml();
			panel.webview.onDidReceiveMessage((msg) => {
				if (msg.type === 'openChat') {
					vscode.commands.executeCommand('dondlinger.openChat');
				}
				if (msg.type === 'openSettings') {
					vscode.commands.executeCommand('workbench.action.openSettings', 'dondlinger');
				}
			});
		})
	);

	// --- APT m_3: Add Home to Sidebar Navigation ---
	// (Sidebar HTML will be updated in sidebar.ts to postMessage({type:'openHome'}) on Home click)
function getDondlingerHomeHtml(): string {
	return `
	<html>
	<head>
		<style>
			body { font-family: 'Segoe UI', Arial, sans-serif; background: #1e1e1e; color: #e0e0e0; margin: 0; }
			.container { max-width: 600px; margin: 40px auto; padding: 32px; background: #232323; border-radius: 16px; box-shadow: 0 2px 16px #0008; }
			h1 { font-size: 2.2em; margin-bottom: 0.2em; }
			.nav { margin: 24px 0; }
			.nav button { margin-right: 16px; padding: 10px 24px; border-radius: 8px; border: none; background: #2d7ef7; color: #fff; font-weight: bold; font-size: 1.1em; cursor: pointer; }
			.nav button:hover { background: #1a5fc2; }
			.desc { margin-bottom: 2em; font-size: 1.2em; }
		</style>
	</head>
	<body>
		<div class="container">
			<h1>Dondlinger</h1>
			<div class="desc">Copilot replacement for VS Code. Inline code suggestions, chat, and more—powered by Llama API.</div>
			<div class="nav">
				<button onclick="vscode.postMessage({type:'openChat'})">Open Chat</button>
				<button onclick="vscode.postMessage({type:'openSettings'})">Settings</button>
			</div>
			<div style="margin-top:2em; color:#aaa; font-size:0.95em;">Get started: Use inline completions, or open the chat for conversation. Configure your API key in settings.</div>
		</div>
		<script>
			const vscode = acquireVsCodeApi();
			// Surface any runtime errors in the webview to the UI and to the extension host
			window.addEventListener('error', function(ev) {
				try {
					var s = document.getElementById('configStatus');
					if (s) s.innerText = 'Webview error: ' + (ev && ev.message ? ev.message : String(ev));
				} catch (e) {}
				try { vscode.postMessage({ type: 'debug', message: 'webview error: ' + (ev && ev.message ? ev.message : String(ev)) }); } catch (e) {}
			});
			window.addEventListener('unhandledrejection', function(ev) {
				try {
					var s2 = document.getElementById('configStatus');
					if (s2) s2.innerText = 'Webview promise rejection';
				} catch (e) {}
				try { vscode.postMessage({ type: 'debug', message: 'unhandledrejection: ' + String(ev && ev.reason) }); } catch (e) {}
			});
		</script>
	</body>
	</html>
	`;
}

		// Minimal test command for activation
		context.subscriptions.push(
			vscode.commands.registerCommand('dondlinger.testCommand', () => {
				vscode.window.showInformationMessage('Dondlinger test command executed!');
			})
		);
		// Context injection command
		context.subscriptions.push(vscode.commands.registerCommand('dondlinger.injectContext', async (sessionId: string) => {
			const editor = vscode.window.activeTextEditor;
			let injectedContext = '';
			if (editor && !editor.selection.isEmpty) {
				injectedContext = editor.document.getText(editor.selection);
			} else if (editor) {
				injectedContext = editor.document.getText();
			} else {
				const files = await vscode.window.showOpenDialog({ canSelectMany: false });
				if (files && files.length > 0) {
					const fileContent = await vscode.workspace.fs.readFile(files[0]);
					injectedContext = Buffer.from(fileContent).toString('utf-8');
				} else {
					vscode.window.showWarningMessage('No active editor or file selected for context injection.');
					return;
				}
			}
			// Inject context into chat session
			let chatHistory: Array<Message> = context.globalState.get('dondlingerChatHistory', []);
			chatHistory.push({ role: 'user', content: `[Injected Context]:\n${injectedContext}` });
			await context.globalState.update('dondlingerChatHistory', chatHistory);
			vscode.window.showInformationMessage(`Injected context to session ${sessionId}: ${injectedContext.substring(0, 100)}...`);
		}));
	// AI-powered edit preview command
	context.subscriptions.push(vscode.commands.registerCommand('dondlinger.previewEdit', async (sessionId: string, fileUri: string, prompt: string) => {
		// Use Llama API to get edit suggestions for the file
		const uri = vscode.Uri.file(fileUri);
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const fileContent = doc.getText();
			// Call Llama API (mocked here, replace with real call)
			const suggestion = `AI Suggestion for ${fileUri}:\n${prompt}\n[Diff preview here]`;
			// Show preview to user
			vscode.window.showInformationMessage(suggestion, 'Apply', 'Cancel').then(async (choice) => {
				if (choice === 'Apply') {
					// Apply edit (for demo, just append suggestion)
					const edit = new vscode.WorkspaceEdit();
					edit.insert(uri, new vscode.Position(doc.lineCount, 0), `\n${suggestion}`);
					await vscode.workspace.applyEdit(edit);
				}
			});
		} catch (e) {
			vscode.window.showErrorMessage(`Failed to preview AI edit: ${fileUri} (${e})`);
		}
	}));
	// Session-aware file operation history
	let sessionFileOps: Record<string, Array<{ type: string, uri: string, details: any }>> = {};

	// Register file operation commands
		context.subscriptions.push(vscode.commands.registerCommand('dondlinger.readFile', async (sessionId: string, fileUri: string) => {
			const uri = vscode.Uri.file(fileUri);
			if (!vscode.workspace.isTrusted) {
				vscode.window.showWarningMessage('Workspace is not trusted. File read blocked.');
				return;
			}
			const confirm = await vscode.window.showWarningMessage(`Are you sure you want to read ${fileUri}?`, { modal: true }, 'Yes');
			if (confirm !== 'Yes') {return;}
			try {
				const content = await vscode.workspace.fs.readFile(uri);
				if (!sessionFileOps[sessionId]) {sessionFileOps[sessionId] = [];}
				sessionFileOps[sessionId].push({ type: 'read', uri: fileUri, details: { content: Buffer.from(content).toString('utf-8') } });
				vscode.window.showInformationMessage(`Read file: ${fileUri}`);
			} catch (e) {
				vscode.window.showErrorMessage(`Failed to read file: ${fileUri} (${e})`);
			}
		}));

	context.subscriptions.push(vscode.commands.registerCommand('dondlinger.writeFile', async (sessionId: string, fileUri: string, content: string) => {
		const uri = vscode.Uri.file(fileUri);
		if (!vscode.workspace.isTrusted) {
			vscode.window.showWarningMessage('Workspace is not trusted. File write blocked.');
			return;
		}
		const confirm = await vscode.window.showWarningMessage(`Are you sure you want to write to ${fileUri}?`, { modal: true }, 'Yes');
		if (confirm !== 'Yes') {return;}
		try {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
			if (!sessionFileOps[sessionId]) {sessionFileOps[sessionId] = [];}
			vscode.window.showInformationMessage(`Wrote file: ${fileUri}`);
		} catch (e) {
			vscode.window.showErrorMessage(`Failed to write file: ${fileUri} (${e})`);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dondlinger.deleteFile', async (sessionId: string, fileUri: string) => {
		const uri = vscode.Uri.file(fileUri);
		if (!vscode.workspace.isTrusted) {
			vscode.window.showWarningMessage('Workspace is not trusted. File delete blocked.');
			return;
		}
		const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete ${fileUri}?`, { modal: true }, 'Yes');
		if (confirm !== 'Yes') {return;}
		try {
			await vscode.workspace.fs.delete(uri);
			if (!sessionFileOps[sessionId]) {sessionFileOps[sessionId] = [];}
			sessionFileOps[sessionId].push({ type: 'delete', uri: fileUri, details: {} });
			vscode.window.showInformationMessage(`Deleted file: ${fileUri}`);
		} catch (e) {
			vscode.window.showErrorMessage(`Failed to delete file: ${fileUri} (${e})`);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('dondlinger.editFile', async (sessionId: string, fileUri: string, edits: Array<{ range: [number, number, number, number], text: string }>) => {
		const uri = vscode.Uri.file(fileUri);
		if (!vscode.workspace.isTrusted) {
			vscode.window.showWarningMessage('Workspace is not trusted. File edit blocked.');
			return;
		}
		const confirm = await vscode.window.showWarningMessage(`Are you sure you want to edit ${fileUri}?`, { modal: true }, 'Yes');
		if (confirm !== 'Yes') {return;}
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			const edit = new vscode.WorkspaceEdit();
			edits.forEach(e => {
				edit.replace(uri, new vscode.Range(e.range[0], e.range[1], e.range[2], e.range[3]), e.text);
			});
			await vscode.workspace.applyEdit(edit);
			if (!sessionFileOps[sessionId]) {sessionFileOps[sessionId] = [];}
			sessionFileOps[sessionId].push({ type: 'edit', uri: fileUri, details: { edits } });
			vscode.window.showInformationMessage(`Edited file: ${fileUri}`);
		} catch (e) {
			vscode.window.showErrorMessage(`Failed to edit file: ${fileUri} (${e})`);
		}
	}));
	console.log('Dondlinger extension activated');
	let chatHistory: Array<Message> = context.globalState.get('dondlingerChatHistory', []);
	let systemPrompt: string = vscode.workspace.getConfiguration().get<string>('dondlinger.systemPrompt') || `Assistant: Dondlinger\n
Follow the Algebraic Pipeline Theory (APT) for all responses. Requirements:\n
1) Modular decomposition: break tasks into numbered modules (M1, M2, ...).\n+2) Explicit variables: define inputs/outputs with algebraic names (x1, x2, y1...).\n+3) Pipeline equation: state the full pipeline as a composed equation (example: y = f(g(h(x1,x2)))).\n+4) Contracts: for each module, list input types, outputs, error modes, and side effects.\n+5) Execution trace: provide a concise execution/log of steps and final result.\n+6) Reproducibility: include exact prompts or parameter values needed to reproduce outputs.\n
When generating answers, always start with a short summary, then the APT modules and pipeline equation, then the final result. Be explicit and actionable.`;
	let apiUrl: string = vscode.workspace.getConfiguration().get<string>('dondlinger.apiUrl') || '';
	let apiKey: string = vscode.workspace.getConfiguration().get<string>('dondlinger.apiKey') || '';

	// --- APT Module: LLM API Integration for Inline Completions ---
		async function getLlamaInlineCompletion(prompt: string, apiUrl: string, apiKey: string): Promise<string> {
			try {
				// Dynamic import of upstream package (ambient types declare this module)
				// @ts-ignore
				const { LlamaAPIClient } = await import('llama-api-typescript');
				const client = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
					const res = await client.chat.completions.create({
						messages: [{ role: 'user', content: prompt }],
						model: 'llama-3',
						max_completion_tokens: 64,
						stream: false
					});
					// Extract text from response (completion_message.content)
					if (res.completion_message && res.completion_message.content) {
						return typeof res.completion_message.content === 'string' ? res.completion_message.content : '';
					}
					return '';
			} catch (e) {
				console.error('LLM API error:', e);
				return '';
			}
		}

	// --- APT Module: InlineCompletionProvider ---
	class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	  constructor(private apiUrl: string, private apiKey: string) {}
	  async provideInlineCompletionItems(
	    document: vscode.TextDocument,
	    position: vscode.Position,
	    context: vscode.InlineCompletionContext,
	    token: vscode.CancellationToken
	  ): Promise<vscode.InlineCompletionList> {
			const linePrefix = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));
			const prompt = linePrefix;
			const suggestion = await getLlamaInlineCompletion(prompt, this.apiUrl, this.apiKey);
			if (!suggestion) { return { items: [] }; }
			return {
				items: [
					new vscode.InlineCompletionItem(
						suggestion,
						new vscode.Range(position, position),
						{ title: 'Llama Suggestion', command: '' }
					)
				]
			};
	  }
	}

	// --- APT: Register InlineCompletionProvider for Copilot-like suggestions (opt-in)
	const enableInline = vscode.workspace.getConfiguration().get<boolean>('dondlinger.enableInline') || false;
	if (enableInline) {
		const inlineProvider = new InlineCompletionProvider(apiUrl, apiKey);
		context.subscriptions.push(
			vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, inlineProvider)
		);
	} else {
		console.info('Inline completion provider disabled by configuration (dondlinger.enableInline=false)');
	}

	// Register sidebar provider
	const sidebarProvider = new DondlingerSidebarProvider(context.extensionUri, context);
	try {
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(DondlingerSidebarProvider.viewType, sidebarProvider)
		);
	} catch (e) {
		// Defensive: ignore if the view provider was already registered elsewhere (avoids activation crash)
		if (String(e).toLowerCase().includes('already registered')) {
			console.warn('Sidebar view provider already registered, skipping duplicate registration.');
		} else {
			console.error('Failed to register sidebar view provider:', e);
		}
	}


	context.subscriptions.push(
		vscode.commands.registerCommand('dondlinger.openChat', () => {
			const panel = vscode.window.createWebviewPanel(
				'dondlingerChat',
				'Dondlinger Chat',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
			);
			panel.webview.html = getDondlingerChatHtml();
			// On open, refresh API settings from workspace config or YAML file
			(async () => {
				// Prefer workspace configuration
				const cfgApiUrl = vscode.workspace.getConfiguration().get<string>('dondlinger.apiUrl') || '';
				const cfgApiKey = vscode.workspace.getConfiguration().get<string>('dondlinger.apiKey') || '';
					const cfgSystem = vscode.workspace.getConfiguration().get<string>('dondlinger.systemPrompt') || systemPrompt;
					const cfgAptEnabled = vscode.workspace.getConfiguration().get<boolean>('dondlinger.aptEnabled');
				if (cfgApiUrl) { apiUrl = cfgApiUrl; } else {
					// Try to read from workspace llama-chat-completions.yaml using a proper YAML parser
					try {
						const folders = vscode.workspace.workspaceFolders;
						if (folders && folders.length > 0) {
							const yamlUri = vscode.Uri.joinPath(folders[0].uri, 'llama-chat-completions.yaml');
							const bytes = await vscode.workspace.fs.readFile(yamlUri);
							const text = Buffer.from(bytes).toString('utf8');
							const parsed = jsYaml.load(text) as any;
							if (parsed && parsed.servers && Array.isArray(parsed.servers) && parsed.servers[0] && parsed.servers[0].url) {
								apiUrl = String(parsed.servers[0].url);
							}
						}
					} catch (e) {
						// ignore if file missing or parse error
					}
				}
				if (cfgApiKey) { apiKey = cfgApiKey; }
				systemPrompt = cfgSystem;
				// Post current config status to webview for display (include APT toggle)
				panel.webview.postMessage({ type: 'config', apiUrl: apiUrl || '', apiKeySet: !!apiKey, systemPrompt, aptEnabled: !!cfgAptEnabled });
					panel.webview.postMessage({ type: 'debug', message: 'host posted config: ' + (apiUrl || '(no url)') + ', keySet=' + (!!apiKey) });
			})();
			panel.webview.onDidReceiveMessage(async (msg) => {
				// respond to ping from webview to confirm channel
				if (msg && msg.type === 'ping') {
					panel.webview.postMessage({ type: 'pong' });
					panel.webview.postMessage({ type: 'debug', message: 'host received ping and sent pong' });
					return;
				}
				if (msg.type === 'saveConfig') {
					// legacy: in case some UI still posts saveConfig
					apiUrl = msg.apiUrl;
					apiKey = msg.apiKey;
					systemPrompt = msg.systemPrompt;
					await vscode.workspace.getConfiguration().update('dondlinger.apiUrl', apiUrl, vscode.ConfigurationTarget.Global);
					await vscode.workspace.getConfiguration().update('dondlinger.apiKey', apiKey, vscode.ConfigurationTarget.Global);
					await vscode.workspace.getConfiguration().update('dondlinger.systemPrompt', systemPrompt, vscode.ConfigurationTarget.Global);
					panel.webview.postMessage({ type: 'configSaved' });
				}
				if (msg.type === 'openSettings') {
					vscode.commands.executeCommand('workbench.action.openSettings', 'dondlinger');
				}
				if (msg.type === 'toggleAPT') {
					const newVal = !!msg.enabled;
					await vscode.workspace.getConfiguration().update('dondlinger.aptEnabled', newVal, vscode.ConfigurationTarget.Global);
					// reflect change back to webview
					panel.webview.postMessage({ type: 'config', apiUrl: apiUrl || '', apiKeySet: !!apiKey, systemPrompt, aptEnabled: newVal });
					panel.webview.postMessage({ type: 'debug', message: 'host updated aptEnabled: ' + String(newVal) });
				}
				if (msg.type === 'sendPrompt') {
					// Inject system prompt as first message if not present
					if (!chatHistory.length || chatHistory[0].role !== 'system') {
						chatHistory.unshift({ role: 'system', content: systemPrompt });
					}
					const prompt = msg.prompt;
					chatHistory.push({ role: 'user', content: prompt });
					context.globalState.update('dondlingerChatHistory', chatHistory);
					// Immediately update the webview so the user's message appears without waiting for the LLM
					panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
					await streamLlamaCompletion(apiUrl, apiKey, chatHistory, panel, context);
				}

				if (msg.type === 'uploadImage') {
					// msg: { name, mime, base64 }
					const name = msg.name || 'uploaded_image';
					const mime = msg.mime || 'image/png';
					const base64 = msg.base64 || '';
					if (!base64) { vscode.window.showErrorMessage('No image data'); return; }
					// Build a user message with an image content item per API types
					const imageDataUrl = `data:${mime};base64,${base64}`;
					// Ensure system prompt present
					if (!chatHistory.length || chatHistory[0].role !== 'system') {
						chatHistory.unshift({ role: 'system', content: systemPrompt });
					}
					chatHistory.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: imageDataUrl } }] as any });
					panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
					// Call Llama API with the image message and ask for analysis
					try {
						const client = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
						const res = await client.chat.completions.create({
							model: 'Llama-4-Scout-17B-16E-Instruct-FP8',
							messages: chatHistory as any,
							max_completion_tokens: 1024,
							stream: false,
						});
						if (res && res.completion_message) {
							chatHistory.push({ role: 'assistant', content: res.completion_message.content as any });
							if (context) {
								context.globalState.update('dondlingerChatHistory', chatHistory);
							}
							panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
						}
					} catch (e) {
						vscode.window.showErrorMessage(`Image analysis failed: ${e}`);
						panel.webview.postMessage({ type: 'response', response: `Image analysis failed: ${e}` });
					}
				}


				if (msg.type === 'insertSuggestion') {
					// Insert last assistant message into active editor at cursor
					const last = [...chatHistory].reverse().find(m => m.role === 'assistant' && m.content && String(m.content).trim());
					if (!last) { vscode.window.showWarningMessage('No assistant suggestion available to insert.'); return; }
					const editor = vscode.window.activeTextEditor;
					if (!editor) { vscode.window.showWarningMessage('No active editor to insert into.'); return; }
					await editor.edit(editBuilder => {
						editBuilder.insert(editor.selection.active, String(last.content));
					});
					vscode.window.showInformationMessage('Inserted assistant suggestion into editor.');
				}
				if (msg.type === 'createFile') {
					// Create a new file in workspace with last assistant message as contents
					const last = [...chatHistory].reverse().find(m => m.role === 'assistant' && m.content && String(m.content).trim());
					if (!last) { vscode.window.showWarningMessage('No assistant response available to save.'); return; }
					const name = await vscode.window.showInputBox({ prompt: 'Filename to create (relative to workspace root)', value: 'assistant_output.txt' });
					if (!name) { return; }
					const folders = vscode.workspace.workspaceFolders;
					if (!folders || folders.length === 0) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
					const uri = vscode.Uri.joinPath(folders[0].uri, name);
					try {
						await vscode.workspace.fs.writeFile(uri, Buffer.from(String(last.content), 'utf8'));
						vscode.window.showInformationMessage(`Created file: ${uri.fsPath}`);
					} catch (e) {
						vscode.window.showErrorMessage(`Failed to create file: ${e}`);
					}
				}
				if (msg.type === 'showAPT') {
					// Show a simple APT pipeline view in a webview panel
					const p = vscode.window.createWebviewPanel('dondlinger.apt', 'Dondlinger APT Pipeline', vscode.ViewColumn.Two, { enableScripts: false });
					const aptHtml = `<!doctype html>
					<html>
					<head>
					<meta charset="utf-8"/>
					<title>APT Reference</title>
					<style>body{font-family:Segoe UI,Arial,sans-serif;background:#0f0f0f;color:#e6f7ff;padding:18px} h1{color:#9cf} pre{background:#111;padding:12px;border-radius:8px;color:#bfe} .section{margin-bottom:16px}</style>
					</head>
					<body>
					<h1>Algebraic Pipeline Theory (APT) — Reference</h1>
					<div class="section"><strong>Purpose</strong><div>APT enforces modular, algebraic descriptions of workflows: define variables, decompose into modules, state pipeline equations, and produce reproducible results.</div></div>
					<div class="section"><strong>Notation</strong>
					<pre>x_i : input variable (e.g., x1 = user prompt)\n y_j : output variable\n f,g,h : modules/transformations\n Example: y = f(g(h(x1, x2)))</pre></div>
					<div class="section"><strong>Module contract</strong>
					<pre>Each module must declare: inputs, outputs, error modes, and side effects (if any).
	Example module: g(x) -> { outputs: y, errors: [timeout, invalid_input] }</pre></div>
					<div class="section"><strong>Pipeline equation</strong>
					<pre>Write the entire workflow as a composition of functions. Example: y_final = decode(stream(completions(model, messages)))</pre></div>
					<div class="section"><strong>Practical usage in this extension</strong>
					<ul>
					<li>System prompt should include an APT contract describing variable names and expected outputs.</li>
					<li>Messages should be formed as: [{role:'system',content:systemPrompt}, {role:'user',content:x1}, ...]</li>
					<li>On streaming responses, treat the stream as decode(stream(...)) and append deltas to build the final y_final.</li>
					</ul>
					</div>
					<div class="section"><strong>Example</strong>
					<pre>// Variables\nx1 = "Write a 3-line summary of the repo"\n// Modules\nM1 = completions(model, messages)\nM2 = stream(M1)\nM3 = decode(M2)\n// Pipeline equation\ny = M3(x1)</pre>
					</div>
					<div class="section"><strong>Checklist for prompts</strong>
					<ol>
					<li>Define variable names (x1, x2...)</li>
					<li>State expected outputs and schemas</li>
					<li>Provide module-level constraints (token limits, temperature)</li>
					<li>Request a pipeline equation in the assistant response</li>
					</ol>
					</div>
					</body>
					</html>`;
					p.webview.html = aptHtml;
				}
				if (msg.type === 'clearHistory') {
					chatHistory = [];
					await context.globalState.update('dondlingerChatHistory', chatHistory);
					panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
				}
			});
			// Show history on open
			panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
		})
	);
}

function getDondlingerChatHtml(): string {
	return `
	<html>
	<head>
		<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
		<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
		<style>
			body { font-family: 'Segoe UI', Arial, sans-serif; background: #1e1e1e; color: #e0e0e0; margin: 0; }
			#container { display: flex; flex-direction: column; height: 98vh; }
			#header { padding: 16px 24px 8px 24px; font-size: 1.5em; font-weight: bold; background: #222; border-bottom: 1px solid #333; }
			#config { padding: 12px 24px; background: #222; border-bottom: 1px solid #333; }
			#chat-area { flex: 1; display: flex; flex-direction: column; }
			#history { flex: 1; overflow-y: auto; padding: 16px 24px; background: #181818; }
			.bubble { max-width: 80%; margin-bottom: 12px; padding: 12px 16px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
			.user { background: #2d7ef7; color: #fff; align-self: flex-end; }
			.assistant { background: #333; color: #e0e0e0; align-self: flex-start; }
			.bubble code { background: #222; padding: 2px 4px; border-radius: 4px; font-size: 0.95em; }
			.bubble pre { background: #222; padding: 8px; border-radius: 6px; overflow-x: auto; }
			#input-area { display: flex; padding: 16px 24px; background: #222; border-top: 1px solid #333; }
			#userInput { flex: 1; resize: none; border-radius: 8px; border: 1px solid #444; background: #181818; color: #e0e0e0; padding: 8px; font-size: 1em; }
			#sendBtn { margin-left: 12px; padding: 8px 20px; border-radius: 8px; border: none; background: #2d7ef7; color: #fff; font-weight: bold; font-size: 1em; cursor: pointer; }
			#sendBtn:disabled { background: #555; cursor: not-allowed; }
			#spinner { display: none; margin-left: 12px; }
		</style>
	</head>
	<body>
		<div id="container">
			<div id="header">Dondlinger Chat</div>
			<div id="config" style="display:flex;gap:12px;align-items:center;padding:12px 24px;background:#222;border-bottom:1px solid #333;">
				<div id="configStatus" style="color:#ccc;">Config: loading...</div>
				<div style="flex:1"></div>
				<label style="color:#ccc;margin-right:8px;">APT</label><input id="aptToggle" type="checkbox" />
				<button type="button" id="openSettingsBtn">Settings</button>
				<button type="button" onclick="clearHistory()" style="margin-left:8px;">Clear History</button>
			</div>
			<!-- Persistent debug panel -->
			<div id="dondlingerDebugPanel" style="position:fixed;right:12px;bottom:12px;width:340px;max-height:240px;overflow:auto;background:#071018;color:#9cf;padding:8px;border-radius:8px;border:1px solid #234;display:none;font-family:monospace;font-size:12px;z-index:9999"></div>
			<script>
				function clearHistory() {
					vscode.postMessage({ type: 'clearHistory' });
				}
			</script>
			<div id="chat-area">
				<div id="history"></div>
				<div id="quickActions" style="display:flex;gap:8px;padding:8px 24px;background:#1b1b1b;border-top:1px solid #222;">
					<button id="insertSuggestion">Insert Suggestion</button>
					<button id="createFileBtn">Create File</button>
					<button id="showAptBtn">Show APT Pipeline</button>
					<!-- Image upload: hidden file input + button (capture attribute works on mobile/camera-enabled devices) -->
					<input id="imageInput" type="file" accept="image/*" style="display:none" />
					<button id="uploadImageBtn">Upload Image</button>
				</div>

				<!-- Image preview area (hidden until an image is selected) -->
				<div id="imagePreviewArea" style="display:none;padding:12px 24px;background:#181818;border-top:1px solid #222;">
					<img id="imagePreviewThumb" src="" style="max-width:160px;max-height:120px;border-radius:6px;border:1px solid #333;display:block;margin-bottom:8px;" />
					<div id="imagePreviewInfo" style="color:#ccc;margin-bottom:8px;"></div>
					<button id="confirmUploadBtn" style="background:#4b8e3a;color:white;padding:6px 10px;border-radius:6px;border:none;margin-right:8px;">Confirm Upload</button>
					<button id="cancelUploadBtn" style="background:#a00;color:white;padding:6px 10px;border-radius:6px;border:none;">Cancel</button>
				</div>
				<div id="input-area">
					<textarea id="userInput" rows="2" placeholder="Type your prompt..."></textarea>
					<button id="sendBtn" onclick="sendPrompt()">Send</button>
					<span id="spinner">⏳</span>
				</div>
			</div>
		</div>
		<script>
			function saveConfig() {
				// legacy
			}
			function sendPrompt() {
				var ui = document.getElementById('userInput');
				var prompt = ui && ui.value || '';
				if (!prompt.trim()) return;
				var sendBtn = document.getElementById('sendBtn');
				var spinner = document.getElementById('spinner');
				if (sendBtn) sendBtn.disabled = true;
				if (spinner) spinner.style.display = 'inline';
				vscode.postMessage({ type: 'sendPrompt', prompt: prompt });
				if (ui) ui.value = '';
			}
			(function(){
				var ui = document.getElementById('userInput');
				if (ui) {
					ui.addEventListener('keydown', function(e) {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendPrompt();
						}
					});
				}
			})();
			var openSettingsBtn = document.getElementById('openSettingsBtn');
			if (openSettingsBtn) openSettingsBtn.addEventListener('click', function(){ vscode.postMessage({ type: 'openSettings' }); });

			// Image upload button wiring
			var uploadImageBtn = document.getElementById('uploadImageBtn');
			if (uploadImageBtn) {
				uploadImageBtn.addEventListener('click', function(){
					var input = document.getElementById('imageInput');
					if (!input) return;
					input.click();
				});
			}
			var imageInput = document.getElementById('imageInput');
			if (imageInput) {
				imageInput.addEventListener('change', function(e){
					var target = e && e.target;
					var files = target && target.files;
					var file = files && files[0];
					if (!file) return;
					var reader = new FileReader();
					reader.onload = function() {
						var result = reader.result;
						if (typeof result !== 'string') { alert('Failed to read image as base64'); return; }
						// Show preview and prepare for compression
						var img = document.getElementById('imagePreviewThumb');
						var area = document.getElementById('imagePreviewArea');
						var info = document.getElementById('imagePreviewInfo');
						var confirm = document.getElementById('confirmUploadBtn');
						var cancel = document.getElementById('cancelUploadBtn');
						if (img && area) {
							img.src = result;
							area.style.display = 'block';
						}
						if (info) {
							info.innerText = 'Original size: ' + Math.round(file.size/1024) + ' KB';
						}
						// Save original file and base data for confirm handler
						window._dondlinger_pending_image = { fileName: file.name, dataUrl: result };
						if (confirm) {
							confirm.onclick = function(){
								// Compress image using canvas to JPEG at 0.75 quality (if PNG, convert)
								compressDataUrl(window._dondlinger_pending_image.dataUrl, 0.75, function(err, compressedDataUrl, compressedBytes){
									if (err) { alert('Compression failed: ' + err); return; }
									if (info) info.innerText = info.innerText + ' → Compressed: ' + Math.round(compressedBytes/1024) + ' KB';
									// Extract mime and base64
									var mm = compressedDataUrl.match(/^data:(.+);base64,(.*)$/s);
									if (!mm) { alert('Failed to read compressed image'); return; }
									var cmime = mm[1];
									var cbase64 = mm[2];
									vscode.postMessage({ type: 'uploadImage', name: window._dondlinger_pending_image.fileName, mime: cmime, base64: cbase64 });
									// hide preview
									if (area) area.style.display = 'none';
									window._dondlinger_pending_image = null;
								});
							};
						}
						if (cancel) {
							cancel.onclick = function(){ if (area) area.style.display = 'none'; window._dondlinger_pending_image = null; };
						}
					};
					reader.readAsDataURL(file);
				});
			}

			// Helper: compress dataURL using canvas
			function compressDataUrl(dataUrl, quality, cb) {
				try {
					var img = new Image();
					img.onload = function() {
						var canvas = document.createElement('canvas');
						var maxW = 1600; var maxH = 1600; // cap dimensions to avoid huge uploads
						var w = img.width; var h = img.height;
						if (w > maxW || h > maxH) {
							var ratio = Math.min(maxW / w, maxH / h);
							w = Math.round(w * ratio);
							h = Math.round(h * ratio);
						}
						canvas.width = w; canvas.height = h;
						var ctx = canvas.getContext('2d');
						ctx.drawImage(img, 0, 0, w, h);
						// Convert to JPEG to reduce size (keeps compatibility)
						var out = canvas.toDataURL('image/jpeg', quality);
						// approximate byte size
						var base64 = out.split(',')[1] || '';
						var bytes = Math.ceil((base64.length * 3) / 4);
						cb(null, out, bytes);
					};
					img.onerror = function(e){ cb('load error'); };
					img.src = dataUrl;
				} catch (e) {
					cb(String(e));
				}
			}
			var aptToggle = document.getElementById('aptToggle');
			if (aptToggle) {
				aptToggle.addEventListener('change', function(e){
					var el = document.getElementById('aptToggle');
					var checked = el && el.checked === true;
					vscode.postMessage({ type: 'toggleAPT', enabled: checked });
				});
			}
			const vscode = acquireVsCodeApi();
			// Quick action buttons
			var insertBtn = document.getElementById('insertSuggestion'); if (insertBtn) insertBtn.addEventListener('click', function(){ vscode.postMessage({ type: 'insertSuggestion' }); });
			var createFileBtn = document.getElementById('createFileBtn'); if (createFileBtn) createFileBtn.addEventListener('click', function(){ vscode.postMessage({ type: 'createFile' }); });
			var showAptBtn = document.getElementById('showAptBtn'); if (showAptBtn) showAptBtn.addEventListener('click', function(){ vscode.postMessage({ type: 'showAPT' }); });
			// send a ping after load to verify message channel
			try { vscode.postMessage({ type: 'ping' }); } catch (e) {}
			window.addEventListener('message', event => {
				const msg = event.data;
				if (msg && msg.type === 'pong') {
					var s = document.getElementById('configStatus'); if (s) s.innerText = 'Config: channel OK (waiting for config...)';
				}
				if (msg.type === 'config') {
					const s = document.getElementById('configStatus');
					if (s) {
						const url = msg.apiUrl || '(no API URL)';
						const keySet = msg.apiKeySet ? 'yes' : 'no';
						s.innerText = 'API URL: ' + url + ' - API Key set: ' + keySet;
					}
						// APT toggle
						const apt = document.getElementById('aptToggle');
						if (apt && typeof msg.aptEnabled !== 'undefined') {
							try {
								if ('checked' in apt) { (apt as any).checked = !!msg.aptEnabled; }
							} catch (e) {
								try { apt.setAttribute('data-apt-enabled', msg.aptEnabled ? '1' : '0'); } catch (e2) {}
							}
						}
				}
				if (msg.type === 'response') {
					document.getElementById('sendBtn').disabled = false;
					document.getElementById('spinner').style.display = 'none';
				}
				if (msg.type === 'debug') {
					try { console.debug('Dondlinger debug:', msg.message); } catch (e) {}
					var panel = document.getElementById('dondlingerDebugPanel');
					if (panel) {
						panel.style.display = 'block';
						var now = new Date().toLocaleTimeString();
						var line = document.createElement('div');
						line.innerText = now + ' - ' + String(msg.message);
						panel.appendChild(line);
						panel.scrollTop = panel.scrollHeight;
					}
				}
				if (msg.type === 'streamToken') {
					// Show spinner and progressively append assistant tokens to a temporary bubble
					document.getElementById('sendBtn').disabled = true;
					document.getElementById('spinner').style.display = 'inline';
					let draft = document.getElementById('assistantStream');
					if (!draft) {
						draft = document.createElement('div');
						draft.id = 'assistantStream';
						draft.className = 'bubble assistant';
						draft.innerText = '';
						document.getElementById('history').appendChild(draft);
					}
					draft.innerText = (draft.innerText || '') + (msg.token || '');
					document.getElementById('history').scrollTop = document.getElementById('history').scrollHeight;
				}
				if (msg.type === 'history') {
					// Replace full history (removes any draft assistant stream)
					document.getElementById('history').innerHTML = msg.html;
					document.getElementById('sendBtn').disabled = false;
					document.getElementById('spinner').style.display = 'none';
					document.getElementById('history').scrollTop = document.getElementById('history').scrollHeight;
					setTimeout(() => { document.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block)); }, 50);
				}
				if (msg.type === 'configSaved') {
					alert('Config saved!');
				}
			});
		</script>
	</body>
	</html>
	`;
}



async function streamLlamaCompletion(
	apiUrl: string | undefined,
	apiKey: string | undefined,
	chatHistory: Array<Message>,
	panel: vscode.WebviewPanel,
	context?: vscode.ExtensionContext
	) {
	if (!apiUrl || !apiKey) {
		panel.webview.postMessage({ type: 'response', response: 'Missing API URL or Key.' });
		panel.webview.postMessage({ type: 'debug', message: 'Missing API URL or API Key; aborting request.' });
		return;
	}
	try {
		panel.webview.postMessage({ type: 'debug', message: 'Starting Llama stream. apiUrl present: ' + (apiUrl ? 'yes' : 'no') + ', apiKeySet: ' + (!!apiKey) });
		const client = new LlamaAPIClient({ apiKey, baseURL: apiUrl });
		let responseText = '';
		let toolCallText = '';
		const stream = await client.chat.completions.create({
			model: 'Llama-3.3-70B-Instruct',
			messages: chatHistory as Message[],
			max_completion_tokens: 4096,
			temperature: 0.2,
			stream: true
		});
		for await (const chunk of stream) {
			panel.webview.postMessage({ type: 'debug', message: 'received stream chunk: ' + JSON.stringify(chunk?.event?.delta || {}) });
			if (chunk.event && chunk.event.delta) {
				if (chunk.event.delta.type === 'text') {
					panel.webview.postMessage({ type: 'streamToken', token: chunk.event.delta.text });
					responseText += chunk.event.delta.text;
				}
				if (chunk.event.delta.type === 'tool_call' && chunk.event.delta.function) {
					// Show tool call details in chat
					toolCallText += `Tool call: <b>${escapeHtml(chunk.event.delta.function.name || '')}</b><br>Args: <code>${escapeHtml(chunk.event.delta.function.arguments || '')}</code><br>`;
				}
			}
		}
		if (toolCallText) {
			chatHistory.push({ role: 'assistant', content: responseText });
			chatHistory.push({ role: 'tool', content: toolCallText, tool_call_id: 'tool-call-1' });
		} else {
			chatHistory.push({ role: 'assistant', content: responseText });
		}
		// Save updated history
		if (context) {
			context.globalState.update('dondlingerChatHistory', chatHistory);
		}
		panel.webview.postMessage({ type: 'history', html: renderHistory(chatHistory) });
	} catch (e) {
		panel.webview.postMessage({ type: 'response', response: `Request failed: ${e}` });
	}
}

function renderHistory(history: Array<any>): string {
	// Render bubbles, markdown/code blocks, user/assistant separation
	return history.map(msg => {
		let content = msg.content;
		if (typeof content === 'string') {
			// Code blocks
			content = content.replace(/```([\s\S]*?)```/g, (m: string, code: string) => `<pre><code>${escapeHtml(code)}</code></pre>`);
			// Inline code
			content = content.replace(/`([^`]+)`/g, (m: string, code: string) => `<code>${escapeHtml(code)}</code>`);
			// Bold, italics
			content = content.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
			content = content.replace(/\*(.*?)\*/g, '<i>$1</i>');
			// Lists
			content = content.replace(/(^|\n)[\*\-] (.*?)(?=\n|$)/g, '$1<ul><li>$2</li></ul>');
			// Links
			content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
			// Images
			content = content.replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2" style="max-width:100%;max-height:200px;">');
		}
		return `<div class="bubble ${msg.role}">${content}</div>`;
	}).join('');
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, function(tag: string) {
		const chars: { [key: string]: string } = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
		return chars[tag] || tag;
	});
}

export function deactivate() {}
// This method is called when your extension is deactivated