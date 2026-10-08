// CustomTextEditorProvider for *.json, *.jsonc and *.json5 (spec 003 T3). The document stays a
// normal VS Code TextDocument; the webview only shows it. The editor UI, its CSP with a nonce and
// localResourceRoots (003 T4) and document sync (003 T5) build on this.
import * as vscode from 'vscode';

export const VIEW_TYPE = 'chrJsonEditor.editor';

export class JsonEditorProvider implements vscode.CustomTextEditorProvider {
  static register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new JsonEditorProvider());
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = { enableScripts: false, localResourceRoots: [] };
    panel.webview.html = placeholderHtml(document.uri);
  }
}

function placeholderHtml(uri: vscode.Uri): string {
  const name = escapeHtml(uri.path.slice(uri.path.lastIndexOf('/') + 1));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
<title>${name}</title>
</head>
<body>
<p>${name} is open in CHR JSON Editor. The tree, text and table views are not built yet; use
"Reopen as Text" to edit it.</p>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
