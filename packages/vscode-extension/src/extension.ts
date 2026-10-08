// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. VS Code activates the extension from the
// contributed custom editor and commands (spec 003 T3).
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { JsonEditorProvider } from './editorProvider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(JsonEditorProvider.register(), ...registerCommands());
}

export function deactivate(): void {}
