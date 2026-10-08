// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. VS Code activates the extension from the
// contributed custom editor and commands (spec 003 T3).
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import type { Mode } from '@chr-json-editor/app-shell/protocol';
import { JsonEditorProvider, type WebviewSnapshot } from './editorProvider';
import type { RenderedProbe } from './testProbe';
import { FormatBadgeController, formatCore, type FormatBadgeSnapshot } from './formatBadgeVscode';

declare const __CHR_TEST_HOOKS__: boolean;

/** Returned from `activate` only in the e2e build (`extension.exports.testHooks`). */
export interface TestHooks {
  webviews(): WebviewSnapshot[];
  /** What the webview of `uri` renders (003 T5); see webview/testHooks.ts. */
  probe(uri: string): Promise<RenderedProbe>;
  /** Posts `setMode` to the webview of `uri`; false when no editor shows it. */
  setMode(uri: string, mode: Mode): boolean;
  formatBadge(): FormatBadgeSnapshot;
  /** Validates the open editor of `uri` against `schema` (004 T2; 004 T5 adds association). */
  setSchema(uri: string, schema: object | boolean | undefined): boolean;
}

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  const formatBadge = new FormatBadgeController(formatCore);
  const { provider, disposable } = JsonEditorProvider.register(context, formatBadge);
  context.subscriptions.push(formatBadge, disposable, ...registerCommands());
  if (__CHR_TEST_HOOKS__) {
    return {
      testHooks: {
        webviews: () => [...provider.snapshots.values()],
        probe: (uri) => provider.probe(uri),
        setMode: (uri, mode) => provider.setMode(uri, mode),
        formatBadge: () => formatBadge.snapshot(),
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
