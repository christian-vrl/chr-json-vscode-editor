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
  /** Resolves once the webview of `uri` renders `text`, whitespace collapsed (003 T11 benchmark). */
  whenShown(uri: string, text: string): Promise<void>;
  /** Has the webview of `uri` send `patch` as a tree edit (criterion 1); false when none shows it. */
  patch(uri: string, patch: unknown): boolean;
  /** Types `text` at the end of the text mode of `uri`'s webview (criterion 9); resolves with the
   *  webview's `Date.now()` after the last character. */
  type(uri: string, text: string): Promise<number>;
  /** Presses Ctrl+`key` (Shift too when `shift`) where the webview of `uri` has focus (003 T7). */
  press(uri: string, key: string, shift?: boolean): boolean;
  /** Clicks the button titled `title` in the webview of `uri` (003 T7). */
  click(uri: string, title: string): boolean;
  /** Posts `setMode` to the webview of `uri`; false when no editor shows it. */
  setMode(uri: string, mode: Mode): boolean;
  formatBadge(): FormatBadgeSnapshot;
  /** Validates the open editor of `uri` against `schema`, over the association (004 T2). */
  setSchema(uri: string, schema: object | boolean | undefined): boolean;
  /** Picks `dialect` in the toolbar's dialect switch of the webview of `uri` (004 T5). */
  selectDialect(uri: string, dialect: string): boolean;
}

export function activate(context: vscode.ExtensionContext): { testHooks: TestHooks } | undefined {
  const formatBadge = new FormatBadgeController(formatCore);
  const { provider, disposable } = JsonEditorProvider.register(context, formatBadge);
  context.subscriptions.push(
    formatBadge,
    disposable,
    formatBadge.onDidChangeFormat(({ document, format }) =>
      provider.formatChanged(document, format),
    ),
    ...registerCommands(),
  );
  if (__CHR_TEST_HOOKS__) {
    return {
      testHooks: {
        webviews: () => [...provider.snapshots.values()],
        probe: (uri) => provider.probe(uri),
        setMode: (uri, mode) => provider.setMode(uri, mode),
        whenShown: (uri, text) => provider.whenShown(uri, text),
        patch: (uri, patch) => provider.patch(uri, patch),
        type: (uri, text) => provider.type(uri, text),
        press: (uri, key, shift) => provider.press(uri, key, shift),
        click: (uri, title) => provider.click(uri, title),
        formatBadge: () => formatBadge.snapshot(),
        selectDialect: (uri, dialect) => provider.selectDialect(uri, dialect),
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
