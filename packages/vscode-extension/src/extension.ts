// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. The no-op command only proves activation until
// spec 003 registers the custom editor.
import * as vscode from 'vscode';

export const NOOP_COMMAND = 'chrJsonEditor.noop';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(NOOP_COMMAND, () => undefined));
}

export function deactivate(): void {}
