import * as vscode from 'vscode';
export class LlamaSidebarProvider implements vscode.WebviewViewProvider {
    constructor(_extensionUri: vscode.Uri);
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void;
    getHtmlForWebview(): string;
    callLlamaApi(apiUrl: string | undefined, apiKey: string | undefined, prompt: string): Promise<string>;
}
