// Web e2e (018 T5; spec 018 criterion 12, spec 013 criterion 7's coverage map): the copy path and
// reveal commands in the web worker extension host on the virtual file system, on
// fixtures/copy-path/ as test/e2e/copyPath.cjs runs them on desktop:
// - criterion 7's `.json` case: "Copy JSONPath" and "Copy JSON Pointer" leave cases.json's expected
//   text on the clipboard in VS Code's text editor at each listed offset of sample.json, and in the
//   CHR JSON Editor with each listed node selected (tree mode, and table mode on rows.json) and at
//   each listed offset (text mode), with the status bar message, the text and version unchanged;
//   the text editor's context menu offers the commands for sample.json and not for notes.txt;
// - criterion 8's "Reveal in CHR JSON Editor": the text tab is replaced, or the CHR JSON Editor's
//   tab in another group made active with the text tab kept, the node selected and its row in view;
// - "Reveal in Text Editor" (spec 013's coverage map): the CHR JSON Editor tab is replaced and the
//   cursor put at the node's place; with unsaved edits the tab stays and the text editor still
//   gets the cursor (018 T3 review, L4).
/// <reference types="mocha" />
import * as vscode from 'vscode';
import type { TestHooks } from '../../../src/extension';
import {
  activateHooks,
  activeTab,
  basename,
  closeAll,
  copyToCase,
  deepEqual,
  equal,
  expectOnly,
  fixture,
  isCustom,
  isText,
  manifest,
  ok,
  openCustom,
  openText,
  probeUntil,
  readText,
  revert,
  tabsFor,
  VIEW_TYPE,
  waitFor,
} from './util';

const COPY_PATH = 'chrJsonEditor.copyJsonPath';
const COPY_POINTER = 'chrJsonEditor.copyJsonPointer';
const REVEAL_IN_EDITOR = 'chrJsonEditor.revealInEditor';
const REVEAL_IN_TEXT = 'chrJsonEditor.revealInText';
const TEXT_KEY = 'chrJsonEditor.textEditorFormat';
const SENTINEL = 'chr-copy-path: nothing copied';
const ROOT_POINTER_MESSAGE = 'Copied the empty JSON Pointer (the whole document)';

const copyPath = (name: string) => fixture('fixtures', 'copy-path', name);

interface TextCase {
  at: string;
  jsonpath: string;
  pointer: string;
}
interface Cases {
  'sample.json': { text: TextCase[]; tree: { select: string; jsonpath: string }[] };
  'rows.json': { table: { select: string; jsonpath: string; pointer: string }[] };
}

async function cases(): Promise<Cases> {
  return JSON.parse(await readText(copyPath('cases.json'))) as Cases;
}

/** Runs `command` and returns what it left on the clipboard. */
async function copied(command: string): Promise<string> {
  await vscode.env.clipboard.writeText(SENTINEL);
  await vscode.commands.executeCommand(command);
  return vscode.env.clipboard.readText();
}

/** Both copy commands on the current node: the clipboard, the status bar, the document kept. */
async function expectCopies(
  hooks: TestHooks,
  label: string,
  document: vscode.TextDocument,
  jsonpath: string,
  pointer: string,
): Promise<void> {
  const { version } = document;
  const text = document.getText();
  hooks.pathCommands();
  equal(await copied(COPY_PATH), jsonpath, `${label}: Copy JSONPath`);
  equal(await copied(COPY_POINTER), pointer, `${label}: Copy JSON Pointer`);
  deepEqual(
    hooks.pathCommands(),
    {
      messages: [],
      status: [`Copied ${jsonpath}`, pointer === '' ? ROOT_POINTER_MESSAGE : `Copied ${pointer}`],
    },
    `${label}: the status bar`,
  );
  equal(document.getText(), text, `${label}: the text`);
  equal(document.version, version, `${label}: the version`);
}

function putCursor(editor: vscode.TextEditor, offset: number): void {
  const position = editor.document.positionAt(offset);
  editor.selection = new vscode.Selection(position, position);
}

/** Waits until the CHR JSON Editor of `uri` has `pointer` selected in tree mode, its row in view. */
async function expectSelected(hooks: TestHooks, uri: vscode.Uri, pointer: string, what: string) {
  const selector = '.jse-tree-mode .jse-json-node[class*="jse-selected"]';
  let last: unknown;
  try {
    await waitFor(`${what}: ${pointer} selected and in view`, async () => {
      last = await hooks
        .dom(uri.toString(), [{ read: selector, attr: 'data-path' }, { inView: selector }])
        .catch((error: unknown) => String(error));
      if (!Array.isArray(last)) return false;
      const [path, inView] = last as (string | null)[];
      return (
        typeof path === 'string' && decodeURIComponent(path) === pointer && inView === 'in view'
      );
    });
  } catch (error) {
    throw new Error(`${String(error)}; last: ${JSON.stringify(last)}`, { cause: error });
  }
}

function lineVisible(editor: vscode.TextEditor, line: number): boolean {
  return editor.visibleRanges.some((range) => range.start.line <= line && line <= range.end.line);
}

/** Opens `uri` in the CHR JSON Editor in `viewColumn`, beside what is open already. */
async function openCustomIn(hooks: TestHooks, uri: vscode.Uri, viewColumn: vscode.ViewColumn) {
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
    viewColumn,
    preview: false,
  });
  await waitFor(`the ${basename(uri)} webview script to run`, () =>
    hooks.webviews().some((view) => view.uri === uri.toString() && view.scriptLoaded),
  );
  await probeUntil(hooks, uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
}

describe('copy path and reveal node (spec 018)', () => {
  it('Copy JSONPath and Copy JSON Pointer copy the node in the text editor and the CHR JSON Editor', async () => {
    const hooks = await activateHooks();
    const all = await cases();
    try {
      // The text editor's context menu: the formats' text editors only, read through the context
      // key its `when` clause names (VS Code's API cannot open the menu).
      const context = manifest().contributes.menus['editor/context'] ?? [];
      deepEqual(
        context.map((m) => m.command),
        [COPY_PATH, COPY_POINTER, REVEAL_IN_EDITOR],
        'the text editor context menu',
      );
      for (const entry of context) {
        ok(entry.when?.includes(`${TEXT_KEY} =~ /^(json|`), `${entry.command}: when`);
      }
      for (const [name, format] of [
        ['sample.json', 'json'],
        ['notes.txt', undefined],
      ] as const) {
        await closeAll();
        await openText(copyPath(name));
        await waitFor(
          `${name}: the text editor format key`,
          () => hooks.convert(undefined).context[TEXT_KEY] === format,
        );
      }

      // VS Code's text editor, the cursor at each listed offset.
      const uri = copyPath('sample.json');
      await closeAll();
      const document = await openText(uri);
      const editor = vscode.window.activeTextEditor!;
      const text = document.getText();
      for (const { at, jsonpath, pointer } of all['sample.json'].text) {
        const offset = text.indexOf(at);
        ok(offset >= 0, `${JSON.stringify(at)} is in sample.json`);
        putCursor(editor, offset);
        await expectCopies(hooks, `text editor at ${offset}`, document, jsonpath, pointer);
      }
      equal(document.isDirty, false, 'text editor: not dirty');

      // The CHR JSON Editor: tree mode with each listed node selected, text mode at each offset.
      await closeAll();
      await openCustom(hooks, uri);
      for (const { select, jsonpath } of all['sample.json'].tree) {
        ok(hooks.select(uri.toString(), select), `select ${select}`);
        await expectCopies(hooks, `tree ${select}`, document, jsonpath, select);
      }
      ok(hooks.setMode(uri.toString(), 'text'), 'text mode');
      await probeUntil(hooks, uri, 'text mode', (p) => p.mode === 'text');
      for (const { at, jsonpath, pointer } of all['sample.json'].text) {
        const offset = text.indexOf(at);
        ok(hooks.cursor(uri.toString(), offset), `the cursor at ${offset}`);
        await expectCopies(hooks, `text mode at ${offset}`, document, jsonpath, pointer);
      }
      equal(document.isDirty, false, 'CHR JSON Editor: not dirty');

      // Table mode: a cell selected as a click selects it.
      await closeAll();
      const rows = copyPath('rows.json');
      const rowsDocument = await openCustom(hooks, rows, 'table');
      for (const { select, jsonpath, pointer } of all['rows.json'].table) {
        const cell = `.jse-table-mode td[data-path="${encodeURIComponent(select)}"] .jse-value-outer`;
        await hooks.dom(rows.toString(), [
          { mousedown: cell },
          { waitFor: `${cell}.jse-selected-value` },
        ]);
        await expectCopies(hooks, `table ${select}`, rowsDocument, jsonpath, pointer);
      }
    } finally {
      await closeAll();
    }
  });

  it('Reveal in CHR JSON Editor shows the text cursor’s node selected and in view', async () => {
    const hooks = await activateHooks();
    const long = copyPath('long.json');
    try {
      // From the text editor alone: its tab is replaced by the CHR JSON Editor's.
      await closeAll();
      const document = await openText(long);
      const { version } = document;
      putCursor(vscode.window.activeTextEditor!, document.getText().indexOf('"key"'));
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await expectOnly(long, 'custom');
      await expectSelected(hooks, long, '/far/deep/deeper/key', 'reveal, text tab replaced');
      equal(document.version, version, 'reveal: the version');
      equal(document.isDirty, false, 'reveal: not dirty');

      // With the CHR JSON Editor open in another group: that tab is made active, the text tab kept.
      await closeAll();
      await openCustomIn(hooks, long, vscode.ViewColumn.One);
      const row = `.jse-tree-mode .jse-json-node[data-path="${encodeURIComponent('/far/deep/deeper')}"]`;
      const shown = await hooks.dom(long.toString(), [{ inView: row }]).then(
        ([inView]) => inView === 'in view',
        () => false,
      );
      equal(shown, false, '/far/deep/deeper is hidden before the reveal');
      const reopened = await vscode.workspace.openTextDocument(long);
      const text = await vscode.window.showTextDocument(reopened, {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
      });
      const before = reopened.version;
      putCursor(text, reopened.getText().indexOf('"deeper"'));
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await waitFor('the CHR JSON Editor tab in the other group to be active', () =>
        isCustom(activeTab()),
      );
      equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One, 'the group');
      equal(tabsFor(long).filter(isText).length, 1, 'the text tab stays open');
      await expectSelected(hooks, long, '/far/deep/deeper', 'reveal, other group');
      equal(reopened.version, before, 'reveal, other group: the version');
    } finally {
      await closeAll();
    }
  });

  it('Reveal in Text Editor puts the cursor at the selected node, also with unsaved edits', async () => {
    const hooks = await activateHooks();
    const keyPointer = '/far/deep/deeper/key';
    try {
      // The CHR JSON Editor tab is replaced by the text editor's, the cursor at the node's place.
      await closeAll();
      const long = copyPath('long.json');
      const document = await openCustom(hooks, long);
      const { version } = document;
      ok(hooks.select(long.toString(), keyPointer), 'select');
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await expectOnly(long, 'text');
      const place = document.getText().indexOf('"key"');
      const editor = vscode.window.activeTextEditor!;
      equal(editor.document, document, 'the text editor on the document');
      equal(document.offsetAt(editor.selection.active), place, 'the cursor at the place');
      await waitFor('the place in view', () =>
        lineVisible(editor, document.positionAt(place).line),
      );
      equal(document.version, version, 'the version');
      equal(document.isDirty, false, 'not dirty');

      // With unsaved edits "Reopen as Text" keeps the CHR JSON Editor tab; the text editor opens
      // beside it in the same group and still gets the cursor (018 T3 review, L4).
      await closeAll();
      const copy = await copyToCase('copy-path', long);
      const dirty = await openCustom(hooks, copy);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(copy, dirty.positionAt(dirty.getText().length), '\n');
      equal(await vscode.workspace.applyEdit(edit), true, 'applyEdit');
      await waitFor('the document to be dirty', () => dirty.isDirty);
      ok(hooks.select(copy.toString(), keyPointer), 'select (dirty)');
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await waitFor('the text tab to be active', () => isText(activeTab()));
      equal(tabsFor(copy).filter(isCustom).length, 1, 'the CHR JSON Editor tab with edits stays');
      const dirtyEditor = vscode.window.activeTextEditor!;
      equal(dirtyEditor.document, dirty, 'the text editor on the document (dirty)');
      const dirtyPlace = dirty.getText().indexOf('"key"');
      await waitFor('the cursor at the place (dirty)', () => {
        return dirty.offsetAt(dirtyEditor.selection.active) === dirtyPlace;
      });
      await revert(dirty);
    } finally {
      await closeAll();
    }
  });
});
