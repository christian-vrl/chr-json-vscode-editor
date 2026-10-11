// Gate for 007 T4 (spec 007 criteria 4–9), run by suite.cjs inside VS Code: the three compare
// commands open the compare panel with its title (4); "Compare with HEAD" reports exactly an
// unsaved edit, and shows a message instead of a panel for an untracked file or one outside Git (5);
// a copy from the page lands as one undoable edit, byte for byte as tests/compare/comments/
// expected-after-copy.*, in a background tab when the file was not open, never into HEAD (6); an
// edit to either document shows in the panel within 1 s (7); JSONC against JSON5 and a side that
// does not parse (8); the panel's CSP and a page with no CSP violation (9); above the size limit,
// no panel and VS Code's text diff offered instead, a HEAD side included (10, 007 T5). The fixtures are copied
// into run.mjs's scratch folder, so the copies never touch the repository's files.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const COMPARE_WITH = 'chrJsonEditor.compareWith';
const COMPARE_SELECTED = 'chrJsonEditor.compareSelected';
const COMPARE_WITH_HEAD = 'chrJsonEditor.compareWithHead';
const COMPARE = path.resolve(__dirname, '../../../../tests/compare');
/** Criterion 7's bound. */
const LIVE_MS = 1000;

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', ...args],
    { cwd },
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isComparePanel(tab) {
  return (
    tab?.input instanceof vscode.TabInputWebview &&
    tab.input.viewType.endsWith('chrJsonEditor.compare')
  );
}

function tabsFor(uri) {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input?.uri?.toString() === uri.toString());
}

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(snapshot: object) => string} t.assertCriterion6 suite.cjs's CSP check
 */
exports.runCompare = async function runCompare({ hooks, waitFor, closeAll, assertCriterion6 }) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'compare-'));
  const copyFixture = (from, to = path.basename(from)) => {
    const file = path.join(dir, to);
    fs.copyFileSync(path.join(COMPARE, from), file);
    return vscode.Uri.file(file);
  };
  const snapshot = (title) => hooks.compares().find((s) => s.title === title && s.open);

  /** The page's probe, retried until `predicate` holds: a webview shown again reloads, and a
   *  probe posted before its script listens gets no answer. */
  async function probeUntil(title, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let last;
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

  async function opened(title) {
    await waitFor(`the compare panel ${title}`, () => snapshot(title)?.scriptLoaded === true);
    await waitFor(`${title} to post its compare`, () => snapshot(title).version > 0);
    return snapshot(title);
  }

  /** Selects difference `index` (0-based) with Next, then clicks "Copy to <to>". */
  async function copyFromPage(title, index, to) {
    const steps = [];
    for (let i = 0; i <= index; i++) {
      steps.push({ click: '.compare .toolbar button', text: 'Next' });
    }
    steps.push({
      waitFor: '.compare .counter',
      text: `Difference ${index + 1} of ${snapshot(title).differences.length} differences`,
    });
    steps.push({ click: '.compare .copy button', text: `Copy to ${to}` });
    await hooks.domCompare(title, steps);
  }

  // --- Compare Selected; criteria 3 and 9 in VS Code; criteria 6 and 7 on tests/compare/comments.
  await closeAll();
  const expected = JSON.parse(
    fs.readFileSync(path.join(COMPARE, 'comments/expected.json'), 'utf8'),
  );
  const copies = JSON.parse(fs.readFileSync(path.join(COMPARE, 'comments/copies.json'), 'utf8'));
  const left = copyFixture('comments/left.jsonc');
  const right = copyFixture('comments/right.jsonc');
  const uris = { left, right };
  await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
  const title = 'left.jsonc ↔ right.jsonc';
  const shown = await opened(title);
  assertCriterion6({ ...shown, uri: left.toString() });
  assert.deepEqual(shown.differences, expected, 'comments: differences');
  let page = await probeUntil(title, 'the comments compare', (p) => p.left.tree && p.right.tree);
  assert.equal(page.counter, `${expected.length} differences`);
  assert.equal(page.left.name, 'left.jsonc');
  assert.equal(page.right.name, 'right.jsonc');
  assert.equal(page.mainMinHeight, '150px', 'compare page: library CSS');
  assert.deepEqual(page.violations, [], 'compare page: CSP violations');
  for (const style of page.styleElements.filter((s) => s.id !== '_defaultStyles')) {
    assert.equal(style.nonce, true, `compare page: <style id="${style.id}"> without the nonce`);
  }
  assert.deepEqual(page.left.marks['chr-diff-changed'].sort(), ['/minify', '/target']);
  assert.deepEqual(page.right.marks['chr-diff-added'], ['/sourcemap']);
  assert.ok(page.left.marks['chr-diff-inside'].includes(''), 'the root holds a difference');
  assert.equal(isComparePanel(vscode.window.tabGroups.activeTabGroup.activeTab), true);
  console.log(`compare: Compare Selected opened "${title}" with ${expected.length} differences`);

  for (const copy of copies) {
    const target = uris[copy.to];
    const document = await vscode.workspace.openTextDocument(target);
    const original = document.getText();
    const after = fs.readFileSync(path.join(COMPARE, 'comments', copy.expected), 'utf8');
    assert.equal(tabsFor(target).length, 0, `${copy.expected}: the target starts with no tab`);
    await copyFromPage(title, copy.difference, copy.to);
    await waitFor(`the copy into ${copy.to}`, () => document.getText() === after);
    await waitFor(`${copy.to} to be dirty`, () => document.isDirty);
    await waitFor(`a background tab for ${copy.to}`, () => tabsFor(target).length === 1);
    assert.equal(
      isComparePanel(vscode.window.tabGroups.activeTabGroup.activeTab),
      true,
      'the compare panel stays in front',
    );
    await waitFor(
      'the panel to compare again',
      () => snapshot(title).differences.length < expected.length,
    );
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
    // The same command shows the open compare again.
    await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
    await probeUntil(
      title,
      'the compare again',
      (p) => p.counter === `${expected.length} differences`,
    );
    console.log(`compare: copy into ${copy.to} = ${copy.expected}, undone in one step`);
  }

  // Criterion 7: an edit applied elsewhere shows within 1 s, measured on the page.
  const rightDocument = await vscode.workspace.openTextDocument(right);
  const edit = new vscode.WorkspaceEdit();
  const minify = rightDocument.getText().indexOf('"minify": true');
  edit.replace(
    right,
    new vscode.Range(
      rightDocument.positionAt(minify),
      rightDocument.positionAt(minify + '"minify": true'.length),
    ),
    '"minify": false',
  );
  const editedAt = Date.now();
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await probeUntil(
    title,
    'the edit in the panel',
    (p) => p.counter === `${expected.length - 1} differences`,
    LIVE_MS * 5,
  );
  const liveMs = Date.now() - editedAt;
  assert.ok(liveMs <= LIVE_MS, `criterion 7: the edit showed after ${liveMs} ms`);
  console.log(`compare: an edit to right.jsonc showed in the panel after ${liveMs} ms`);
  await vscode.window.showTextDocument(rightDocument);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('the edit to revert', () => !rightDocument.isDirty);
  await closeAll();

  // --- Compare With…: JSONC against JSON5, each in its own format (criteria 4 and 8).
  const formatsLeft = copyFixture('formats/left.jsonc');
  const formatsRight = copyFixture('formats/right.json5');
  const formatsExpected = JSON.parse(
    fs.readFileSync(path.join(COMPARE, 'formats/expected.json'), 'utf8'),
  );
  await vscode.window.showTextDocument(formatsLeft);
  let listed;
  hooks.comparePick((files) => {
    listed = files;
    return formatsRight.toString();
  });
  await vscode.commands.executeCommand(COMPARE_WITH);
  hooks.comparePick(undefined);
  assert.ok(Array.isArray(listed), 'Compare With… offered no list');
  assert.ok(!listed.includes(formatsLeft.toString()), 'the list offers the document itself');
  const formatsTitle = 'left.jsonc ↔ right.json5';
  assert.deepEqual((await opened(formatsTitle)).differences, formatsExpected);
  page = await probeUntil(formatsTitle, 'the formats compare', (p) => p.left.tree && p.right.tree);
  assert.equal(page.counter, `${formatsExpected.length} differences`);
  console.log(`compare: Compare With… opened "${formatsTitle}"`);
  await closeAll();

  // A side that does not parse shows its error, and nothing is compared (criterion 8).
  const broken = vscode.Uri.file(path.join(dir, 'broken.json'));
  fs.writeFileSync(broken.fsPath, '{"a": 1\n');
  const fine = vscode.Uri.file(path.join(dir, 'fine.json'));
  fs.writeFileSync(fine.fsPath, '{"a": 2}\n');
  await vscode.commands.executeCommand(COMPARE_SELECTED, broken, [broken, fine]);
  const brokenTitle = 'broken.json ↔ fine.json';
  assert.deepEqual((await opened(brokenTitle)).differences, []);
  page = await probeUntil(brokenTitle, 'the parse error', (p) => p.left.error !== null);
  assert.equal(page.left.tree, false);
  assert.equal(page.right.error, null);
  assert.equal(page.counter, 'Not compared: a side does not parse');
  console.log(`compare: a side that does not parse shows "${page.left.error}"`);
  await closeAll();

  // A selection that is not two compare files opens nothing.
  const before = hooks.compares().length;
  hooks.comparePick(undefined);
  await vscode.commands.executeCommand(COMPARE_SELECTED, broken, [broken]);
  assert.deepEqual(hooks.comparePick(undefined), [
    'Select exactly two .json, .jsonc or .json5 files to compare.',
  ]);
  assert.equal(hooks.compares().length, before);

  // --- Compare with HEAD (criteria 4, 5 and 6).
  const repo = fs.mkdtempSync(path.join(scratch, 'compare-git-'));
  const outside = fs.mkdtempSync(path.join(scratch, 'compare-nogit-'));
  try {
    git(repo, 'init', '-q');
    const committed = path.join(repo, 'data.jsonc');
    fs.writeFileSync(committed, '{\n  // committed\n  "name": "CHR",\n  "n": 1\n}\n');
    git(repo, 'add', 'data.jsonc');
    git(repo, 'commit', '-q', '-m', 'fixture');
    const untracked = path.join(repo, 'new.json');
    fs.writeFileSync(untracked, '{"new": true}\n');
    const loose = path.join(outside, 'loose.json');
    fs.writeFileSync(loose, '{"loose": true}\n');

    const uri = vscode.Uri.file(committed);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const change = new vscode.WorkspaceEdit();
    const n = document.getText().indexOf('"n": 1');
    change.replace(
      uri,
      new vscode.Range(document.positionAt(n), document.positionAt(n + '"n": 1'.length)),
      '"n": 2',
    );
    assert.equal(await vscode.workspace.applyEdit(change), true);
    await waitFor('the unsaved edit', () => document.isDirty);
    await vscode.commands.executeCommand(COMPARE_WITH_HEAD);
    const headTitle = 'data.jsonc (HEAD) ↔ data.jsonc';
    const head = await opened(headTitle);
    assert.equal(head.left, `head:${uri.toString()}`);
    assert.deepEqual(head.differences, [{ kind: 'changed', leftPath: '/n', rightPath: '/n' }]);
    page = await probeUntil(headTitle, 'the HEAD compare', (p) => p.left.tree && p.right.tree);
    assert.equal(page.left.name, 'data.jsonc (HEAD)');
    await hooks.domCompare(headTitle, [{ click: '.compare .toolbar button', text: 'Next' }]);
    page = await probeUntil(headTitle, 'the difference selected', (p) => p.right.canCopyInto);
    assert.equal(page.left.canCopyInto, false, 'the HEAD side offers no copy into it');
    console.log(`compare: Compare with HEAD reports the unsaved edit only`);

    for (const [file, message] of [
      [untracked, 'new.json is not in Git HEAD'],
      [loose, 'loose.json is not in a Git repository'],
    ]) {
      const count = hooks.compares().length;
      hooks.comparePick(undefined);
      await vscode.commands.executeCommand(COMPARE_WITH_HEAD, vscode.Uri.file(file));
      assert.deepEqual(hooks.comparePick(undefined), [message]);
      assert.equal(hooks.compares().length, count, `${message}: no compare panel opens`);
      console.log(`compare: ${message}`);
    }

    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await waitFor('the HEAD edit to revert', () => !document.isDirty);
    await closeAll();
  } finally {
    // As in gitHead.cjs: run.mjs deletes the scratch folder once VS Code has exited.
    await vscode.commands.executeCommand('git.close', vscode.Uri.file(repo));
  }

  await runSizeLimit({ hooks, waitFor, closeAll, dir, scratch, opened, snapshot });
};

/** A JSON document of exactly `bytes` UTF-8 bytes; with `accent`, one "é" (2 bytes, 1 UTF-16 code
 *  unit) in it, so its UTF-16 length is one less than its size. */
function jsonOfBytes(bytes, accent = false) {
  const frame = '{"pad": ""}\n'.length;
  const body = accent ? 'é' + 'a'.repeat(bytes - frame - 2) : 'a'.repeat(bytes - frame);
  const text = `{"pad": "${body}"}\n`;
  assert.equal(Buffer.byteLength(text), bytes);
  return text;
}

function textDiffTabs() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputTextDiff);
}

/** Criterion 10 (007 T5): up to UNK-037's limit the panel opens; above it (the UTF-8 size of the
 *  larger side, as currently edited) no panel opens and the message offers VS Code's text diff of
 *  the same two documents, HEAD side included. */
async function runSizeLimit({ hooks, waitFor, closeAll, dir, scratch, opened, snapshot }) {
  const limit = hooks.compareLimit(undefined, true);
  hooks.comparePick(undefined);
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return vscode.Uri.file(file);
  };
  const small = write('small.json', '{"pad": "a"}\n');
  const atLimit = write('at-limit.json', jsonOfBytes(limit));
  // One UTF-16 code unit short of the limit, one byte above it in UTF-8: too large.
  const above = write('above.json', jsonOfBytes(limit + 1, true));

  await closeAll();
  await vscode.commands.executeCommand(COMPARE_SELECTED, atLimit, [atLimit, small]);
  const atTitle = 'at-limit.json ↔ small.json';
  assert.deepEqual((await opened(atTitle)).differences, [
    { kind: 'changed', leftPath: '/pad', rightPath: '/pad' },
  ]);
  assert.deepEqual(hooks.comparePick(undefined), [], 'at the limit: no message');
  console.log(`compare: a side of exactly ${limit} bytes opens the compare panel`);
  await closeAll();

  const mib = (bytes) => `${(bytes / 2 ** 20).toFixed(1).replace(/\.0$/, '')} MiB`;
  const offer = (name) =>
    `${name} is larger than the ${mib(limit)} compare limit. ` +
    "Open VS Code's text diff of the two documents instead?";

  // Dismissed: nothing opens.
  hooks.compareLimit(undefined, false);
  let count = hooks.compares().length;
  await vscode.commands.executeCommand(COMPARE_SELECTED, small, [small, above]);
  assert.deepEqual(hooks.comparePick(undefined), [offer('above.json')]);
  assert.equal(hooks.compares().length, count, 'above the limit: no compare panel');
  assert.equal(textDiffTabs().length, 0, 'dismissed: no text diff');

  // Accepted: VS Code's text diff of the same two documents, left as original.
  hooks.compareLimit(undefined, true);
  await vscode.commands.executeCommand(COMPARE_SELECTED, small, [small, above]);
  assert.deepEqual(hooks.comparePick(undefined), [offer('above.json')]);
  assert.equal(hooks.compares().length, count, 'above the limit: no compare panel');
  await waitFor('the text diff', () => textDiffTabs().length === 1);
  let [tab] = textDiffTabs();
  assert.equal(tab.input.original.toString(), small.toString());
  assert.equal(tab.input.modified.toString(), above.toString());
  assert.equal(tab.label, 'small.json ↔ above.json');
  console.log(`compare: above the limit "${offer('above.json')}" opens the text diff`);
  await closeAll();

  // Sizes are the documents as currently edited: an unsaved edit that takes the at-limit side
  // above the limit falls back too.
  const atDocument = await vscode.workspace.openTextDocument(atLimit);
  await vscode.window.showTextDocument(atDocument);
  const grow = new vscode.WorkspaceEdit();
  grow.insert(atLimit, atDocument.positionAt('{"pad": "'.length), 'b');
  assert.equal(await vscode.workspace.applyEdit(grow), true);
  await waitFor('the unsaved edit', () => atDocument.isDirty);
  count = hooks.compares().length;
  await vscode.commands.executeCommand(COMPARE_SELECTED, atLimit, [atLimit, small]);
  assert.deepEqual(hooks.comparePick(undefined), [offer('at-limit.json')]);
  assert.equal(hooks.compares().length, count, 'an unsaved edit above the limit: no panel');
  await waitFor('the text diff of the edited document', () => textDiffTabs().length === 1);
  await vscode.window.showTextDocument(atDocument);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('the edit to revert', () => !atDocument.isDirty);
  await closeAll();

  // HEAD: the committed text is served to the text diff, as committed.
  const repo = fs.mkdtempSync(path.join(scratch, 'compare-limit-git-'));
  try {
    git(repo, 'init', '-q');
    const committed = path.join(repo, 'large.json');
    const committedText = jsonOfBytes(limit + 1);
    fs.writeFileSync(committed, committedText);
    git(repo, 'add', 'large.json');
    git(repo, 'commit', '-q', '-m', 'fixture');
    const uri = vscode.Uri.file(committed);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    count = hooks.compares().length;
    await vscode.commands.executeCommand(COMPARE_WITH_HEAD);
    assert.deepEqual(hooks.comparePick(undefined), [offer('large.json (HEAD)')]);
    assert.equal(hooks.compares().length, count, 'HEAD above the limit: no compare panel');
    await waitFor('the HEAD text diff', () => textDiffTabs().length === 1);
    [tab] = textDiffTabs();
    assert.equal(tab.input.original.scheme, 'chr-json-head');
    assert.equal(tab.input.modified.toString(), uri.toString());
    assert.equal(tab.label, 'large.json (HEAD) ↔ large.json');
    const head = await vscode.workspace.openTextDocument(tab.input.original);
    assert.equal(head.getText(), committedText, 'the HEAD side shows the committed text');
    console.log('compare: Compare with HEAD above the limit opens the text diff with HEAD');
    await closeAll();
  } finally {
    hooks.compareLimit(undefined, undefined);
    await vscode.commands.executeCommand('git.close', vscode.Uri.file(repo));
  }
  // The compare panels opened above stay listed; none is open.
  assert.equal(snapshot('at-limit.json ↔ small.json'), undefined);
}
