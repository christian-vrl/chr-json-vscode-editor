// Node entry (001 T5). esbuild bundles this file into dist/extension.js, the manifest's `main`;
// `vscode` stays external because VS Code supplies it at runtime. VS Code activates the extension
// from the contributed custom editor and commands (spec 003 T3). The editor itself is the shared one
// in activate.ts; this entry adds the Node-only services from src/node/ (spec 013 criterion 2), and
// is the only file outside src/node/ that may import them.
import type * as vscode from 'vscode';
import { activateShared, type TestHooks } from './activate';
import { readHeadOf } from './node/gitHeadVscode';

export type { TestHooks } from './activate';

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  return activateShared(context, { readHead: readHeadOf });
}

export function deactivate(): void {}
