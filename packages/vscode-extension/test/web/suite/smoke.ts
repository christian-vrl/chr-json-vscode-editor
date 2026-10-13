// Web e2e smoke (013 T1): spec 013 criterion 3 on one `.json` fixture, and "Smart Format" (010 T3). The rest of criterion 3, and
// criteria 4, 5, 7, 9 and 11, are 013 T4's web suite.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import type { TestHooks } from '../../../src/extension';

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';

async function waitFor<T>(
  what: string,
  check: () => T | Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function equal(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

describe('web host smoke (spec 013 criterion 3, one fixture)', () => {
  let hooks: TestHooks;

  it('runs in the web worker extension host and activates the extension there', async () => {
    // No Node: the suite and the extension share the worker (plan R2).
    equal(typeof (globalThis as { process?: unknown }).process, 'undefined', 'typeof process');
    const extension = vscode.extensions.getExtension<{ testHooks?: TestHooks }>(EXTENSION_ID);
    if (!extension) throw new Error(`${EXTENSION_ID} is not loaded in the web host`);
    // Rejects with the activation error, if any.
    const exports = await extension.activate();
    if (!extension.isActive) throw new Error('the extension did not activate');
    if (!exports?.testHooks)
      throw new Error('no test hooks: build the .vsix with CHR_TEST_HOOKS=1');
    hooks = exports.testHooks;
    // Restricted Mode turns the extension off (spec 013 §Where we differ); README.md records it.
    console.log(`web e2e: workspace trusted: ${vscode.workspace.isTrusted}`);
    if (!vscode.workspace.isTrusted)
      throw new Error('the test workspace starts in Restricted Mode');
  });

  it('opens sample.json in CHR JSON Editor with the document’s data', async () => {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    if (!folder) throw new Error('no workspace folder is open');
    console.log(`web e2e: workspace folder ${folder.uri.toString()}`);
    const uri = vscode.Uri.joinPath(folder.uri, 'open', 'sample.json');
    const document = await vscode.workspace.openTextDocument(uri);
    const expected: unknown = JSON.parse(document.getText());

    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await waitFor('the sample.json webview script to run', () =>
      hooks.webviews().some((view) => view.uri === uri.toString() && view.scriptLoaded),
    );
    // The editor library holds the data as `{ json }` or as `{ text }` (testProbe.ts).
    const probe = await waitFor('the editor to render', async () => {
      const shown = await hooks.probe(uri.toString());
      return shown.mode !== null && shown.content ? shown : undefined;
    });
    const content = probe.content as { text: string } | { json: unknown };
    const data: unknown = 'json' in content ? content.json : JSON.parse(content.text);
    equal(data, expected, 'webview data');
    equal(probe.mode, 'tree', 'mode');
    equal(probe.format, 'JSON', 'format label');
    equal(probe.violations, [], 'CSP violations');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // Spec 010 criterion 8 in the web host (010 T3): the command has no Node-only code.
  it('runs "Smart Format" on smart-format/input.json in the text editor', async () => {
    const [folder] = vscode.workspace.workspaceFolders ?? [];
    if (!folder) throw new Error('no workspace folder is open');
    const dir = vscode.Uri.joinPath(folder.uri, 'smart-format');
    const expected = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, 'expected.json')),
    );
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(dir, 'input.json'),
    );
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('chrJsonEditor.smartFormat');
    await waitFor('the smart-formatted text', () => document.getText() === expected);
    equal(document.isDirty, true, 'dirty');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
