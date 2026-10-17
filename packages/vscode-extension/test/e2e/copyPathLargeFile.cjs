// Gate for 018 T4 (spec 018 criterion 11 in VS Code), run by suite.cjs inside VS Code on spec 008's
// 6 MiB JSON fixture (largeFile.cjs `documentText`), written into run.mjs's scratch folder. The node
// is the last item's last key, the far end of the text:
// - in VS Code's text editor, "Copy JSONPath" and "Copy JSON Pointer" copy its path under the
//   progress notification "Finding the node…", the text and version unchanged;
// - "Reveal in CHR JSON Editor" replaces the text tab with a locked large-file tab, the node
//   selected and in view; with that tab open in another group it is made active and stays locked
//   (criterion 8's lock state, 018 T3 review L1);
// - in the locked tab the copy commands copy the selected node's path (the page names it, so no
//   text is read and no progress shows), and "Reveal in Text Editor" puts the text cursor at its
//   place under the progress notification, replacing the tab or making the open text tab in
//   another group active while the locked tab stays locked;
// - the document's text, version and dirty state never change;
// - the threshold is the `largeFileThreshold` setting (spec 019 T1): at 10 MiB the same copies in
//   the text editor show no progress.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const COPY_PATH = 'chrJsonEditor.copyJsonPath';
const COPY_POINTER = 'chrJsonEditor.copyJsonPointer';
const REVEAL_IN_EDITOR = 'chrJsonEditor.revealInEditor';
const REVEAL_IN_TEXT = 'chrJsonEditor.revealInText';
const SIX_MIB = 6 * 1024 * 1024;
const FINDING = 'Finding the node…';
const SENTINEL = 'chr-copy-path: nothing copied';
const LOCKED = { bytes: SIX_MIB, unlocked: false };

exports.runCopyPathLargeFile = async function runCopyPathLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'copy-path-large-file-'));
  const file = path.join(dir, 'six.json');
  const text = documentText('json', SIX_MIB);
  fs.writeFileSync(file, text);
  const uri = vscode.Uri.file(file);
  const key = uri.toString();
  const view = () => hooks.webviews().find((w) => w.uri === key);
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabsFor = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input?.uri?.toString() === key);

  // The last item's last (only) key, `"id"` in `{"id": 2}`.
  const last = JSON.parse(text).length - 1;
  const place = text.lastIndexOf('"id"');
  const pointer = `/${last}/id`;
  const jsonpath = `$[${last}].id`;

  async function probeUntil(what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(key);
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        const rest = { ...probe, content: probe.content && '(omitted)' };
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(rest)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async function openText(viewColumn) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { viewColumn, preview: false });
    return { document, editor };
  }

  /** Opens the fixture in the CHR JSON Editor and waits for its locked tree. */
  async function openLocked(viewColumn) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
      viewColumn,
      preview: false,
    });
    await waitFor('the six.json webview', () => view()?.scriptLoaded === true, 60000);
    await probeUntil('the document in the editor', (p) => p.mode === 'tree' && !!p.content);
    assert.deepEqual(view().largeFile, LOCKED, 'a locked large-file tab');
    return document;
  }

  async function setThreshold(value) {
    const config = vscode.workspace.getConfiguration('chrJsonEditor');
    await config.update('largeFileThreshold', value, vscode.ConfigurationTarget.Global);
    await waitFor(`largeFileThreshold = ${value}`, () => {
      const inspected = vscode.workspace
        .getConfiguration('chrJsonEditor')
        .inspect('largeFileThreshold');
      return inspected?.globalValue === value;
    });
  }

  async function copied(command) {
    await vscode.env.clipboard.writeText(SENTINEL);
    await vscode.commands.executeCommand(command);
    return vscode.env.clipboard.readText();
  }

  /** Both copy commands on the current node; `progress` is whether each read the text. */
  async function expectCopies(label, document, progress) {
    const { version } = document;
    hooks.pathCommands();
    hooks.pathProgress();
    assert.equal(await copied(COPY_PATH), jsonpath, `${label}: Copy JSONPath`);
    assert.equal(await copied(COPY_POINTER), pointer, `${label}: Copy JSON Pointer`);
    assert.deepEqual(
      hooks.pathCommands(),
      { messages: [], status: [`Copied ${jsonpath}`, `Copied ${pointer}`] },
      `${label}: the status bar`,
    );
    assert.deepEqual(
      hooks.pathProgress(),
      progress ? [FINDING, FINDING] : [],
      `${label}: progress`,
    );
    unchanged(label, document, version);
  }

  function unchanged(label, document, version) {
    assert.ok(document.getText() === text, `${label}: the text changed`);
    assert.equal(document.version, version, `${label}: the version`);
    assert.equal(document.isDirty, false, `${label}: dirty`);
  }

  /** The selected tree row is the node's, inside the webview's viewport. */
  async function expectSelected(label) {
    const selector = '.jse-tree-mode .jse-json-node[class*="jse-selected"]';
    const deadline = Date.now() + 30000;
    let lastSeen;
    for (;;) {
      try {
        const [at, inView] = await hooks.dom(key, [
          { read: selector, attr: 'data-path' },
          { inView: selector },
        ]);
        lastSeen = { pointer: decodeURIComponent(at ?? ''), inView };
        if (lastSeen.pointer === pointer && inView === 'in view') return;
      } catch (error) {
        lastSeen = String(error);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${label}: ${pointer} selected and in view; last: ${JSON.stringify(lastSeen)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** The active text editor when it shows `document`: a tab can be active before
   *  `activeTextEditor` follows, so it is read inside each wait (as in copyPath.cjs). */
  function activeEditorOf(document) {
    const editor = vscode.window.activeTextEditor;
    return editor?.document === document ? editor : undefined;
  }

  async function expectCursor(label, document) {
    await waitFor(`${label}: the cursor at the place`, () => {
      const editor = activeEditorOf(document);
      return (
        !!editor && document.offsetAt(editor.selection.active) === place && editor.selection.isEmpty
      );
    });
    const line = document.positionAt(place).line;
    await waitFor(`${label}: the place in view`, () => {
      const editor = activeEditorOf(document);
      return (
        !!editor && editor.visibleRanges.some((r) => r.start.line <= line && line <= r.end.line)
      );
    });
  }

  try {
    await closeAll();

    // VS Code's text editor: the copies read the text under the progress notification.
    {
      const { document, editor } = await openText();
      const position = document.positionAt(place);
      editor.selection = new vscode.Selection(position, position);
      await expectCopies('text editor', document, true);
      console.log('large file: the copy commands in the text editor, under "Finding the node…"');

      // "Reveal in CHR JSON Editor" replaces the text tab with a locked tab, the node in view.
      const { version } = document;
      hooks.pathProgress();
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      assert.deepEqual(hooks.pathProgress(), [FINDING], 'reveal: progress');
      await expectOnly(uri, 'custom', isCustom);
      await waitFor('the six.json webview', () => view()?.scriptLoaded === true, 60000);
      await expectSelected('reveal in the CHR JSON Editor');
      assert.deepEqual(view().largeFile, LOCKED, 'reveal: the tab is locked');
      unchanged('reveal in the CHR JSON Editor', document, version);
      console.log('large file: "Reveal in CHR JSON Editor" opens the locked tab on the node');

      // In the locked tab, the copies name the selected node.
      await expectCopies('locked tab', document, false);
      assert.deepEqual(view().largeFile, LOCKED, 'copy: the tab is locked');
      console.log('large file: the copy commands in the locked tab');

      // "Reveal in Text Editor" replaces the locked tab, the cursor at the place.
      hooks.pathProgress();
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await expectOnly(uri, 'text', isText);
      assert.deepEqual(hooks.pathProgress(), [FINDING], 'reveal in text: progress');
      await expectCursor('reveal in text', document);
      unchanged('reveal in text', document, version);
      console.log(
        'large file: "Reveal in Text Editor" from the locked tab, the cursor at the place',
      );
    }

    // Both editors open in two groups: each reveal makes the other one's tab active, and the
    // CHR JSON Editor's tab stays open and locked.
    {
      await closeAll();
      const document = await openLocked(vscode.ViewColumn.One);
      const { editor } = await openText(vscode.ViewColumn.Two);
      const { version } = document;
      const position = document.positionAt(place);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await waitFor('the locked tab to be active', () => isCustom(activeTab()));
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One);
      await expectSelected('reveal in the open locked tab');
      assert.deepEqual(view().largeFile, LOCKED, 'reveal in the open tab: still locked');
      assert.equal(tabsFor().filter(isText).length, 1, 'the text tab stays open');

      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await waitFor('the text tab to be active', () => isText(activeTab()));
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two);
      await expectCursor('reveal in the open text tab', document);
      assert.equal(tabsFor().filter(isCustom).length, 1, 'the locked tab stays open');
      assert.deepEqual(view().largeFile, LOCKED, 'reveal in text: still locked');
      unchanged('both groups', document, version);
      console.log('large file: the reveals between two groups keep the tab locked');
    }

    // With `largeFileThreshold` 10, 6 MiB is under the threshold: no progress (spec 019 T1).
    {
      await closeAll();
      await setThreshold(10);
      const { document, editor } = await openText();
      const position = document.positionAt(place);
      editor.selection = new vscode.Selection(position, position);
      await expectCopies('threshold 10', document, false);
      console.log('large file: at a 10 MiB threshold, the copies show no progress');
    }
  } finally {
    await setThreshold(undefined);
    await closeAll();
  }
};
