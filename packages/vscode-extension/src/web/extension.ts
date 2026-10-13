// Browser entry (spec 013 T1, ADR-013): esbuild bundles this file into dist/web/extension.js, the
// manifest's `browser` entry, which VS Code's web worker extension host loads in vscode.dev and
// github.dev (and desktop VS Code with --extensionDevelopmentKind=web). The editor itself is the
// shared one in ../extension.ts. Until 013 T2 splits out the Node-only code, the browser build
// resolves the shared code's `node:path` to ./nodePath.ts (esbuild.web.mjs).
import * as vscode from 'vscode';
import { activate as activateShared, type TestHooks } from '../extension';

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  // Spec 013 criterion 8: only this entry sets the key, first thing, so `when` clauses can hide
  // desktop-only commands in desktop VS Code's web host, where `isWeb` is false.
  void vscode.commands.executeCommand('setContext', 'chrJsonEditor.webHost', true);
  return activateShared(context);
}

export function deactivate(): void {}
