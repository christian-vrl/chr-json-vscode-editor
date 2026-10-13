// Shared helpers of the web e2e suite (013 T4). The suite runs in the web worker extension host:
// no Node, so files are read and written through `workspace.fs` in the mounted folder (run.mjs
// copies the fixtures there), and the checks are this file's small assertions, not node:assert.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import type { TestHooks } from '../../../src/extension';

export const EXTENSION_ID = 'christian-vrl.chr-json-editor';
export const VIEW_TYPE = 'chrJsonEditor.editor';
export const FORMATS = ['json', 'jsonc', 'json5'] as const;
export type Format = (typeof FORMATS)[number];

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Assertions.

export function ok(value: unknown, what: string): asserts value {
  if (!value) throw new Error(what);
}

/** Strict equality (`===`), with both values in the message. */
export function equal(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** JSON with object keys sorted, so key order does not count (as node:assert's deepEqual). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function deepEqual(actual: unknown, expected: unknown, what: string): void {
  const a = canonical(actual);
  const e = canonical(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

export function match(actual: string | null | undefined, pattern: RegExp, what: string): void {
  if (typeof actual !== 'string' || !pattern.test(actual)) {
    throw new Error(`${what}: ${JSON.stringify(actual)} does not match ${pattern}`);
  }
}

/** Polls `check` until it gives a truthy value, which it returns. */
export async function waitFor<T>(
  what: string,
  check: () => T | Promise<T>,
  timeoutMs = 10_000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

// --- The extension.

let hooks: TestHooks | undefined;

/** Activates the extension (rejecting with its activation error) and returns its test hooks. */
export async function activateHooks(): Promise<TestHooks> {
  if (hooks) return hooks;
  const extension = vscode.extensions.getExtension<{ testHooks?: TestHooks }>(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not loaded in the web host`);
  const exports = await extension.activate();
  if (!exports?.testHooks) throw new Error('no test hooks: build the .vsix with CHR_TEST_HOOKS=1');
  hooks = exports.testHooks;
  return hooks;
}

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
  };
}

export function manifest(): Manifest {
  return vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON as Manifest;
}

/** The browser route (CI): VS Code's web build in Chromium; false on the local route (desktop). */
export function inBrowser(): boolean {
  return vscode.env.uiKind === vscode.UIKind.Web;
}

// --- Files in the mounted folder.

export function folder(): vscode.Uri {
  const [first] = vscode.workspace.workspaceFolders ?? [];
  if (!first) throw new Error('no workspace folder is open');
  return first.uri;
}

/** A path under the mounted folder: `fixtures/…` (tests/e2e/fixtures), `compare/…`, `csv/…`,
 *  `golden/…` (run.mjs `makeWorkspace`). */
export function fixture(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(folder(), ...segments);
}

export function basename(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

export function dirname(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: uri.path.slice(0, uri.path.lastIndexOf('/')) });
}

/** The file's text, a byte order mark included (spec 006: it stays the encoding mark). */
export async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

export async function writeText(uri: vscode.Uri, text: string): Promise<vscode.Uri> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  return uri;
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function size(uri: vscode.Uri): Promise<number> {
  return (await vscode.workspace.fs.stat(uri)).size;
}

/** The names in a folder, sorted. */
export async function list(dir: vscode.Uri): Promise<string[]> {
  return (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name).sort();
}

let cases = 0;

/** A new empty folder under `work/` for one case, so its files never meet another case's. */
export async function caseDir(prefix: string): Promise<vscode.Uri> {
  const dir = fixture('work', `${prefix}-${++cases}`);
  await vscode.workspace.fs.createDirectory(dir);
  return dir;
}

/** Copies `from` into a new case folder (as `name`) and returns the copy. */
export async function copyToCase(prefix: string, from: vscode.Uri, name = basename(from)) {
  const to = vscode.Uri.joinPath(await caseDir(prefix), name);
  await vscode.workspace.fs.copy(from, to);
  return to;
}

/** Writes `text` into a new case folder as `name`. */
export async function writeToCase(prefix: string, name: string, text: string) {
  return writeText(vscode.Uri.joinPath(await caseDir(prefix), name), text);
}

// --- Tabs and editors.

export function tabsFor(uri: vscode.Uri): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => (tab.input as { uri?: vscode.Uri })?.uri?.toString() === uri.toString());
}

export function isCustom(tab: vscode.Tab | undefined): boolean {
  return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
}

export function isText(tab: vscode.Tab | undefined): boolean {
  return tab?.input instanceof vscode.TabInputText;
}

export function activeTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

export async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((group) => !group.tabs.length),
  );
}

/** Waits until `uri` is shown in exactly one tab, of the kind `check` accepts, and it is active. */
export async function expectOnly(
  uri: vscode.Uri,
  kind: 'custom' | 'text',
  check: (tab: vscode.Tab | undefined) => boolean = kind === 'custom' ? isCustom : isText,
): Promise<void> {
  await waitFor(`${basename(uri)} to show only in the ${kind} editor`, () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && check(tabs[0]) && activeTab() === tabs[0];
  });
}

type Probe = Awaited<ReturnType<TestHooks['probe']>>;

/** Polls the webview of `uri` until `predicate(probe)` holds; returns that probe. */
export async function probeUntil(
  hooks: TestHooks,
  uri: vscode.Uri,
  what: string,
  predicate: (probe: Probe) => boolean,
  timeoutMs = 10_000,
): Promise<Probe> {
  const deadline = Date.now() + timeoutMs;
  let probe: Probe;
  for (;;) {
    probe = await hooks.probe(uri.toString());
    if (predicate(probe)) return probe;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
    }
    await sleep(100);
  }
}

/** Opens `uri` in the CHR JSON Editor and waits until its editor holds the document, in `mode`. */
export async function openCustom(
  hooks: TestHooks,
  uri: vscode.Uri,
  mode: 'tree' | 'text' | 'table' = 'tree',
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  await expectOnly(uri, 'custom');
  await waitFor(`the ${basename(uri)} webview script to run`, () =>
    hooks.webviews().some((view) => view.uri === uri.toString() && view.scriptLoaded),
  );
  await probeUntil(hooks, uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
  if (mode !== 'tree') {
    equal(hooks.setMode(uri.toString(), mode), true, `${basename(uri)}: setMode`);
    await probeUntil(hooks, uri, `${mode} mode`, (p) => p.mode === mode);
  }
  return document;
}

export async function openText(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  await expectOnly(uri, 'text');
  return document;
}

/** The webview snapshot of `uri`'s editor. */
export function view(hooks: TestHooks, uri: vscode.Uri) {
  const found = hooks.webviews().find((w) => w.uri === uri.toString());
  if (!found) throw new Error(`no webview for ${basename(uri)}`);
  return found;
}

/** Replaces the whole text of `document` with an external WorkspaceEdit. */
export async function replaceAll(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text,
  );
  equal(await vscode.workspace.applyEdit(edit), true, 'applyEdit');
}

/** Reverts the active editor and waits until `document` is clean. */
export async function revert(document: vscode.TextDocument): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor(`${basename(document.uri)} to revert`, () => !document.isDirty);
}
