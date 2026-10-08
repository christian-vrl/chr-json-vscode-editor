// Extension host entry (001 T5). esbuild bundles this file into dist/extension.js; `vscode` stays
// external because VS Code supplies it at runtime. VS Code activates the extension from the
// contributed custom editor and commands (spec 003 T3).
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { JsonEditorProvider, type WebviewSnapshot } from './editorProvider';
import {
  FormatBadgeController,
  loadFormatCore,
  type FormatBadgeSnapshot,
} from './formatBadgeVscode';

declare const __CHR_TEST_HOOKS__: boolean;

/** Returned from `activate` only in the e2e build (`extension.exports.testHooks`). */
export interface TestHooks {
  webviews(): WebviewSnapshot[];
  formatBadge(): FormatBadgeSnapshot | undefined;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<{ testHooks: TestHooks } | undefined> {
  // The editor still opens if core fails to load; only the format badge is missing then.
  let formatBadge: FormatBadgeController | undefined;
  try {
    formatBadge = new FormatBadgeController(await loadFormatCore());
    context.subscriptions.push(formatBadge);
  } catch (error) {
    console.error('CHR JSON Editor: the format badge is off, core failed to load', error);
  }
  const { provider, disposable } = JsonEditorProvider.register(context, formatBadge);
  context.subscriptions.push(disposable, ...registerCommands());
  if (__CHR_TEST_HOOKS__) {
    return {
      testHooks: {
        webviews: () => [...provider.snapshots.values()],
        formatBadge: () => formatBadge?.snapshot(),
      },
    };
  }
  return undefined;
}

export function deactivate(): void {}
