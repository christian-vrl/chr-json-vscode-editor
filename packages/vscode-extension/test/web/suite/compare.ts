// Web e2e, spec 013 criterion 9 (013 T4): "Compare With…" and "Compare Selected" on two files on
// the virtual scheme open the compare panel with the differences of the tests/compare/ fixtures,
// and copying one difference across is one undoable edit (spec 007 criteria 4 and 6), as
// test/e2e/compare.cjs checks it on desktop. Also: an edit shows in the open panel (criterion 7),
// a side that does not parse (8), the panel's page under its CSP (9), and the text diff offered
// above the size limit (10). Each case compares copies under work/.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  caseDir,
  closeAll,
  copyToCase,
  deepEqual,
  dirname,
  equal,
  fixture,
  ok,
  readText,
  sleep,
  tabsFor,
  waitFor,
  writeText,
} from './util';
import type { TestHooks } from '../../../src/extension';

const COMPARE_WITH = 'chrJsonEditor.compareWith';
const COMPARE_SELECTED = 'chrJsonEditor.compareSelected';

function isComparePanel(tab: vscode.Tab | undefined): boolean {
  return (
    tab?.input instanceof vscode.TabInputWebview &&
    tab.input.viewType.endsWith('chrJsonEditor.compare')
  );
}

type PageProbe = Awaited<ReturnType<TestHooks['probeCompare']>>;

function helpers(hooks: TestHooks) {
  const snapshot = (title: string) => hooks.compares().find((s) => s.title === title && s.open);

  /** The page's probe, retried until `predicate` holds: a webview shown again reloads, and a
   *  probe posted before its script listens gets no answer. */
  async function probeUntil(title: string, what: string, predicate: (p: PageProbe) => boolean) {
    const deadline = Date.now() + 15_000;
    let last: PageProbe | undefined;
    for (;;) {
      try {
        last = await Promise.race([
          hooks.probeCompare(title),
          sleep(1000).then(() => Promise.reject(new Error('no answer'))),
        ]);
        if (predicate(last)) return last;
      } catch {
        // Not loaded yet.
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(last)}`);
      }
      await sleep(50);
    }
  }

  async function opened(title: string) {
    await waitFor(`the compare panel ${title}`, () => snapshot(title)?.scriptLoaded === true);
    await waitFor(`${title} to post its compare`, () => snapshot(title)!.version > 0);
    return snapshot(title)!;
  }

  return { snapshot, probeUntil, opened };
}

describe('compare on the virtual scheme (spec 013 criterion 9)', () => {
  it('Compare Selected opens the compare panel, and a copy is one undoable edit', async () => {
    const hooks = await activateHooks();
    const { snapshot, probeUntil, opened } = helpers(hooks);
    const dir = fixture('compare', 'comments');
    const expected = JSON.parse(
      await readText(vscode.Uri.joinPath(dir, 'expected.json')),
    ) as unknown[];
    const copies = JSON.parse(await readText(vscode.Uri.joinPath(dir, 'copies.json'))) as {
      difference: number;
      to: 'left' | 'right';
      expected: string;
    }[];
    const left = await copyToCase('compare', vscode.Uri.joinPath(dir, 'left.jsonc'));
    const right = vscode.Uri.joinPath(dirname(left), 'right.jsonc');
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(dir, 'right.jsonc'), right);
    const uris = { left, right };
    await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
    const title = 'left.jsonc ↔ right.jsonc';
    const shown = await opened(title);
    deepEqual(shown.differences, expected, 'differences');
    const page = await probeUntil(
      title,
      'the comments compare',
      (p) => p.left.tree && p.right.tree,
    );
    equal(page.counter, `${expected.length} differences`, 'counter');
    equal(page.left.name, 'left.jsonc', 'left name');
    equal(page.right.name, 'right.jsonc', 'right name');
    equal(page.mainMinHeight, '150px', 'library CSS');
    deepEqual(page.violations, [], 'CSP violations');
    deepEqual([...page.left.marks['chr-diff-changed']!].sort(), ['/minify', '/target'], 'marks');
    deepEqual(page.right.marks['chr-diff-added'], ['/sourcemap'], 'added marks');
    equal(isComparePanel(vscode.window.tabGroups.activeTabGroup.activeTab), true, 'panel in front');

    for (const copy of copies) {
      const target = uris[copy.to];
      const document = await vscode.workspace.openTextDocument(target);
      const original = document.getText();
      const after = await readText(vscode.Uri.joinPath(dir, copy.expected));
      equal(tabsFor(target).length, 0, `${copy.expected}: the target starts with no tab`);
      const steps = [];
      for (let i = 0; i <= copy.difference; i++) {
        steps.push({ click: '.compare .toolbar button', text: 'Next' });
      }
      steps.push({
        waitFor: '.compare .counter',
        text: `Difference ${copy.difference + 1} of ${snapshot(title)!.differences.length} differences`,
      });
      steps.push({ click: '.compare .copy button', text: `Copy to ${copy.to}` });
      await hooks.domCompare(title, steps);
      await waitFor(`the copy into ${copy.to}`, () => document.getText() === after);
      await waitFor(`${copy.to} to be dirty`, () => document.isDirty);
      await waitFor(`a background tab for ${copy.to}`, () => tabsFor(target).length === 1);
      equal(isComparePanel(vscode.window.tabGroups.activeTabGroup.activeTab), true, 'in front');
      // One undo in that tab restores the text exactly.
      await vscode.window.showTextDocument(document, { preview: false });
      await waitFor(`the ${copy.to} tab to be active`, () =>
        tabsFor(target).some((tab) => tab.isActive && tab.group.isActive),
      );
      await vscode.commands.executeCommand('undo');
      await waitFor(`one undo in ${copy.to}`, () => document.getText() === original);
      await waitFor(`${copy.to} to be clean again`, () => !document.isDirty);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor(`the ${copy.to} tab to close`, () => tabsFor(target).length === 0);
      await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
      await probeUntil(title, 'the compare again', (p) => {
        return p.counter === `${expected.length} differences`;
      });
    }

    // An edit made elsewhere shows in the open panel (spec 007 criterion 7).
    const rightDocument = await vscode.workspace.openTextDocument(right);
    const edit = new vscode.WorkspaceEdit();
    const at = rightDocument.getText().indexOf('"minify": true');
    edit.replace(
      right,
      new vscode.Range(
        rightDocument.positionAt(at),
        rightDocument.positionAt(at + '"minify": true'.length),
      ),
      '"minify": false',
    );
    equal(await vscode.workspace.applyEdit(edit), true, 'applyEdit');
    await probeUntil(title, 'the edit in the panel', (p) => {
      return p.counter === `${expected.length - 1} differences`;
    });
    await vscode.window.showTextDocument(rightDocument);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await waitFor('the edit to revert', () => !rightDocument.isDirty);
    await closeAll();

    // A selection that is not two compare files opens nothing.
    const before = hooks.compares().length;
    hooks.comparePick(undefined);
    await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left]);
    deepEqual(
      hooks.comparePick(undefined),
      ['Select exactly two .json, .jsonc or .json5 files to compare.'],
      'one file selected',
    );
    equal(hooks.compares().length, before, 'panels');
  });

  it('Compare With… opens the compare panel of JSONC against JSON5', async () => {
    const hooks = await activateHooks();
    const { probeUntil, opened } = helpers(hooks);
    const dir = fixture('compare', 'formats');
    const left = await copyToCase('compare-with', vscode.Uri.joinPath(dir, 'left.jsonc'));
    const right = vscode.Uri.joinPath(dirname(left), 'right.json5');
    await vscode.workspace.fs.copy(vscode.Uri.joinPath(dir, 'right.json5'), right);
    const expected = JSON.parse(
      await readText(vscode.Uri.joinPath(dir, 'expected.json')),
    ) as unknown[];
    await vscode.window.showTextDocument(left);
    let listed: string[] | undefined;
    hooks.comparePick((files) => {
      listed = files;
      return right.toString();
    });
    try {
      await vscode.commands.executeCommand(COMPARE_WITH);
    } finally {
      hooks.comparePick(undefined);
    }
    ok(Array.isArray(listed), 'Compare With… offered no list');
    ok(listed.includes(right.toString()), `the list misses right.json5: ${JSON.stringify(listed)}`);
    ok(!listed.includes(left.toString()), 'the list offers the document itself');
    const title = 'left.jsonc ↔ right.json5';
    deepEqual((await opened(title)).differences, expected, 'differences');
    const page = await probeUntil(title, 'the formats compare', (p) => p.left.tree && p.right.tree);
    equal(page.counter, `${expected.length} differences`, 'counter');
    await closeAll();

    // A side that does not parse shows its error, and nothing is compared (spec 007 criterion 8).
    const broken = await writeText(vscode.Uri.joinPath(dirname(left), 'broken.json'), '{"a": 1\n');
    const fine = await writeText(vscode.Uri.joinPath(dirname(left), 'fine.json'), '{"a": 2}\n');
    await vscode.commands.executeCommand(COMPARE_SELECTED, broken, [broken, fine]);
    const brokenTitle = 'broken.json ↔ fine.json';
    deepEqual((await opened(brokenTitle)).differences, [], 'broken: differences');
    const shown = await probeUntil(brokenTitle, 'the parse error', (p) => p.left.error !== null);
    equal(shown.counter, 'Not compared: a side does not parse', 'broken: counter');
    await closeAll();
  });

  it('offers VS Code’s text diff above the compare size limit', async () => {
    const hooks = await activateHooks();
    // A small limit in place of UNK-037's, so the case needs no large file (spec 013 T5 covers
    // large files in the web host).
    const limit = 1000;
    hooks.compareLimit(limit, true);
    try {
      hooks.comparePick(undefined);
      const base = await caseDir('compare-limit');
      const small = await writeText(vscode.Uri.joinPath(base, 'small.json'), '{"pad": "a"}\n');
      const above = await writeText(
        vscode.Uri.joinPath(base, 'above.json'),
        `{"pad": "${'a'.repeat(limit)}"}\n`,
      );
      const count = hooks.compares().length;
      await vscode.commands.executeCommand(COMPARE_SELECTED, small, [small, above]);
      const messages = hooks.comparePick(undefined);
      equal(messages.length, 1, `messages: ${JSON.stringify(messages)}`);
      ok(messages[0]!.startsWith('above.json is larger than the '), `offer: ${messages[0]}`);
      ok(messages[0]!.endsWith("Open VS Code's text diff of the two documents instead?"), 'offer');
      equal(hooks.compares().length, count, 'above the limit: no compare panel');
      const diffs = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.input instanceof vscode.TabInputTextDiff);
      await waitFor('the text diff', () => diffs().length === 1);
      const input = diffs()[0]!.input as vscode.TabInputTextDiff;
      equal(input.original.toString(), small.toString(), 'original');
      equal(input.modified.toString(), above.toString(), 'modified');
      await closeAll();
    } finally {
      hooks.compareLimit(undefined, undefined);
    }
  });
});
