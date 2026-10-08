// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. VS Code activates the extension from the
// contributed custom editor and commands (spec 003 T3).
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { JsonEditorProvider, type WebviewSnapshot } from './editorProvider';

declare const __CHR_TEST_HOOKS__: boolean;

/** Returned from `activate` only in the e2e build (`extension.exports.testHooks`). */
export interface TestHooks {
  webviews(): WebviewSnapshot[];
  /** Validates the open editor of `uri` against `schema` (004 T2; 004 T5 adds association). */
  setSchema(uri: string, schema: object | boolean | undefined): boolean;
}

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  const { provider, disposable } = JsonEditorProvider.register(context);
  context.subscriptions.push(disposable, ...registerCommands());
  if (__CHR_TEST_HOOKS__) {
    return {
      testHooks: {
        webviews: () => [...provider.snapshots.values()],
        setSchema(uri, schema) {
          let found = false;
          for (const [panel, validation] of provider.validations) {
            const snapshot = provider.snapshots.get(panel);
            if (snapshot?.uri !== uri) continue;
            validation.setSchema(schema);
            found = true;
          }
          return found;
        },
      },
    };
  }
  return undefined;
}

export function deactivate(): void {}
