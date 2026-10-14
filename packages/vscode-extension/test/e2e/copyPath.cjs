// Gate for 018 T3 (spec 018 criteria 7, 8 and 9), run by suite.cjs inside VS Code, on
// tests/e2e/fixtures/copy-path/ (cases.json lists the cursor offsets and selected nodes, with the
// expected paths written by hand):
// - criterion 7: "Copy JSONPath" and "Copy JSON Pointer" from their command ids leave the expected
//   text on the clipboard, in VS Code's text editor at each listed offset and in the CHR JSON
//   Editor with each listed node selected (tree and table mode) and at each listed offset (text
//   mode), the document's text and version unchanged; the text editor's context menu offers the
//   three commands for json, jsonc and json5 documents and not for a .txt file (the menus' `when`
//   clause and the context key it reads);
// - criterion 8: "Reveal in CHR JSON Editor" replaces the text tab, or makes the CHR JSON Editor's
//   tab in another group active, with the node selected and its row in the webview's viewport;
//   "Reveal in Text Editor" puts the text cursor at the node's place with that line visible; the
//   document's text, version and dirty state stay;
// - criterion 9: with the cursor after a syntax error each command shows S6's first message, copies
//   nothing and changes no tab; a node an edit removed shows S6's second message.
// Also the page's own `copyText` (S2, S3), written to the clipboard by the host (018 T2 review).
// 018 T4 adds:
// - criterion 10 on lines.jsonl: the copy commands in the text editor (items, blank lines, a bad
//   line) and in the CHR JSON Editor's Table mode, and both reveals landing on the same item and
//   member; the text editor's context menu offers the commands for a .jsonl file too;
// - "Reveal in Text Editor" from a CHR JSON Editor tab with unsaved edits, which "Reopen as Text"
//   keeps open beside the text tab (018 T3 review, L4).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const COPY_PATH = 'chrJsonEditor.copyJsonPath';
const COPY_POINTER = 'chrJsonEditor.copyJsonPointer';
const REVEAL_IN_EDITOR = 'chrJsonEditor.revealInEditor';
const REVEAL_IN_TEXT = 'chrJsonEditor.revealInText';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/copy-path');
const CASES = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'cases.json'), 'utf8'));
const SENTINEL = 'chr-copy-path: nothing copied';
const ROOT_POINTER_MESSAGE = 'Copied the empty JSON Pointer (the whole document)';
const TEXT_KEY = 'chrJsonEditor.textEditorFormat';

const fixture = (name) => vscode.Uri.file(path.join(FIXTURES, name));

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runCopyPath = async function runCopyPath({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
  const tabsFor = (uri) =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input?.uri?.toString() === uri.toString());

  async function probeUntil(uri, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function openText(uri, viewColumn) {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { viewColumn, preview: false });
    return { document, editor };
  }

  function putCursor(editor, offset) {
    const position = editor.document.positionAt(offset);
    editor.selection = new vscode.Selection(position, position);
  }

  /** Opens `uri` in the CHR JSON Editor in `mode` and waits for its document. */
  async function openCustom(uri, mode = 'tree', viewColumn) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
      viewColumn,
      preview: false,
    });
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(
      `the webview of ${path.basename(uri.fsPath)}`,
      () => view()?.scriptLoaded === true,
    );
    await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
    if (mode !== 'tree') {
      assert.equal(hooks.setMode(uri.toString(), mode), true);
      await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
    }
    return document;
  }

  /** Runs `command` and returns what it left on the clipboard. */
  async function copied(command) {
    await vscode.env.clipboard.writeText(SENTINEL);
    await vscode.commands.executeCommand(command);
    return vscode.env.clipboard.readText();
  }

  /** Both copy commands on the current node: the clipboard and the status bar messages. */
  async function expectCopies(label, document, jsonpath, pointer) {
    const { version } = document;
    const text = document.getText();
    hooks.pathCommands();
    assert.equal(await copied(COPY_PATH), jsonpath, `${label}: Copy JSONPath`);
    assert.equal(await copied(COPY_POINTER), pointer, `${label}: Copy JSON Pointer`);
    const pointerMessage = pointer === '' ? ROOT_POINTER_MESSAGE : `Copied ${pointer}`;
    assert.deepEqual(
      hooks.pathCommands(),
      { messages: [], status: [`Copied ${jsonpath}`, pointerMessage] },
      `${label}: the status bar`,
    );
    assert.equal(document.getText(), text, `${label}: the text`);
    assert.equal(document.version, version, `${label}: the version`);
  }

  /** The CHR JSON Editor's selected tree node: its JSON Pointer and whether its row is in view. */
  async function selectedRow(uri) {
    const selector = '.jse-tree-mode .jse-json-node[class*="jse-selected"]';
    const [pointer, inView] = await hooks.dom(uri.toString(), [
      { read: selector, attr: 'data-path' },
      { inView: selector },
    ]);
    return { pointer: decodeURIComponent(pointer ?? ''), inView };
  }

  async function expectSelected(uri, pointer, label) {
    const deadline = Date.now() + 10000;
    let last;
    for (;;) {
      try {
        last = await selectedRow(uri);
        if (last.pointer === pointer && last.inView === 'in view') return;
      } catch (error) {
        last = String(error);
      }
      if (Date.now() > deadline) {
        throw new Error(`${label}: ${pointer} selected and in view; last: ${JSON.stringify(last)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Selects the table cell at JSON Pointer `select` as a click selects it. */
  async function selectCell(uri, select) {
    const cell = `.jse-table-mode td[data-path="${encodeURIComponent(select)}"] .jse-value-outer`;
    await hooks.dom(uri.toString(), [
      { mousedown: cell },
      { waitFor: `${cell}.jse-selected-value` },
    ]);
  }

  function lineVisible(editor, line) {
    return editor.visibleRanges.some((range) => range.start.line <= line && line <= range.end.line);
  }

  try {
    hooks.pathCommands();

    // The commands, in the palette under their titles; the text editor's context menu for the
    // formats' text editors only, read through the context key its `when` clause names.
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const titles = Object.fromEntries(
      manifest.contributes.commands.map((c) => [c.command, `${c.category}: ${c.title}`]),
    );
    assert.equal(titles[COPY_PATH], 'CHR JSON Editor: Copy JSONPath');
    assert.equal(titles[COPY_POINTER], 'CHR JSON Editor: Copy JSON Pointer');
    assert.equal(titles[REVEAL_IN_EDITOR], 'CHR JSON Editor: Reveal in CHR JSON Editor');
    assert.equal(titles[REVEAL_IN_TEXT], 'CHR JSON Editor: Reveal in Text Editor');
    const context = manifest.contributes.menus['editor/context'];
    assert.deepEqual(
      context.map((m) => m.command),
      [COPY_PATH, COPY_POINTER, REVEAL_IN_EDITOR],
      'the text editor context menu',
    );
    for (const entry of context) {
      assert.equal(
        entry.when,
        'activeEditor == workbench.editors.files.textFileEditor && ' +
          `${TEXT_KEY} =~ /^(json|jsonc|json5|jsonl)$/`,
        `${entry.command}: when`,
      );
    }
    for (const [name, format] of [
      ['sample.json', 'json'],
      ['sample.jsonc', 'jsonc'],
      ['sample.json5', 'json5'],
      ['lines.jsonl', 'jsonl'],
      ['notes.txt', undefined],
    ]) {
      await closeAll();
      await openText(fixture(name));
      await waitFor(`${name}: the text editor format key`, () => {
        return hooks.convert(undefined).context[TEXT_KEY] === format;
      });
    }
    console.log('copy path: the commands and the text editor context menu entries');

    // Criterion 7, VS Code's text editor.
    for (const name of ['sample.json', 'sample.jsonc', 'sample.json5']) {
      await closeAll();
      const { document, editor } = await openText(fixture(name));
      const text = document.getText();
      for (const { at, jsonpath, pointer } of CASES[name].text) {
        const offset = text.indexOf(at);
        assert.ok(offset >= 0, `${name}: ${JSON.stringify(at)} is in the fixture`);
        putCursor(editor, offset);
        await expectCopies(`${name} text editor at ${offset}`, document, jsonpath, pointer);
      }
      assert.equal(document.isDirty, false, `${name}: not dirty`);
      console.log(`copy path: ${name} in the text editor`);
    }

    // Criterion 7, the CHR JSON Editor: tree mode with nodes selected, text mode at offsets.
    for (const name of ['sample.json', 'sample.jsonc', 'sample.json5']) {
      await closeAll();
      const uri = fixture(name);
      const document = await openCustom(uri);
      for (const { select, jsonpath } of CASES[name].tree) {
        assert.equal(hooks.select(uri.toString(), select), true);
        await expectCopies(`${name} tree ${select}`, document, jsonpath, select);
      }
      assert.equal(hooks.setMode(uri.toString(), 'text'), true);
      await probeUntil(uri, 'text mode', (p) => p.mode === 'text');
      const text = document.getText();
      for (const { at, jsonpath, pointer } of CASES[name].text) {
        const offset = text.indexOf(at);
        assert.equal(hooks.cursor(uri.toString(), offset), true);
        await expectCopies(`${name} text mode at ${offset}`, document, jsonpath, pointer);
      }
      assert.equal(document.isDirty, false, `${name}: not dirty`);
      console.log(`copy path: ${name} in the CHR JSON Editor, tree and text mode`);
    }

    // Criterion 7, table mode: a cell selected as a click selects it.
    {
      await closeAll();
      const uri = fixture('rows.json');
      const document = await openCustom(uri, 'table');
      for (const { select, jsonpath, pointer } of CASES['rows.json'].table) {
        const cell = `.jse-table-mode td[data-path="${encodeURIComponent(select)}"] .jse-value-outer`;
        await hooks.dom(uri.toString(), [
          { mousedown: cell },
          { waitFor: `${cell}.jse-selected-value` },
        ]);
        await expectCopies(`rows.json table ${select}`, document, jsonpath, pointer);
      }
      console.log('copy path: rows.json in table mode');
    }

    // The page's own copies (S2, S3) reach the clipboard through the host.
    {
      const uri = fixture('rows.json');
      await vscode.env.clipboard.writeText(SENTINEL);
      assert.equal(
        hooks.send(uri.toString(), { type: 'copyText', docVersion: 1, text: '$[1].language' }),
        true,
      );
      const deadline = Date.now() + 5000;
      while ((await vscode.env.clipboard.readText()) !== '$[1].language') {
        if (Date.now() > deadline) throw new Error('the page copy did not reach the clipboard');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      console.log("copy path: the page's copyText is written to the clipboard");
    }

    // Criterion 8: "Reveal in CHR JSON Editor" from the text editor replaces its tab.
    const long = fixture('long.json');
    const keyPointer = '/far/deep/deeper/key';
    {
      await closeAll();
      const { document, editor } = await openText(long);
      const { version } = document;
      putCursor(editor, document.getText().indexOf('"key"'));
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await expectOnly(long, 'custom', isCustom);
      await expectSelected(long, keyPointer, 'reveal in the CHR JSON Editor');
      assert.equal(document.version, version, 'reveal: the version');
      assert.equal(document.isDirty, false, 'reveal: not dirty');
      console.log('reveal: the text tab is replaced by the CHR JSON Editor, the node in view');
    }

    // ...and with the CHR JSON Editor open in another group, that tab is made active.
    {
      await closeAll();
      await openCustom(long, 'tree', vscode.ViewColumn.One);
      // Before the reveal the member is collapsed or out of view.
      const row = `.jse-tree-mode .jse-json-node[data-path="${encodeURIComponent('/far/deep/deeper')}"]`;
      const shown = await hooks.dom(long.toString(), [{ inView: row }]).then(
        ([inView]) => inView === 'in view',
        () => false,
      );
      assert.equal(shown, false, '/far/deep/deeper is hidden before the reveal');
      const { document, editor } = await openText(long, vscode.ViewColumn.Two);
      putCursor(editor, document.getText().indexOf('"deeper"'));
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await waitFor('the CHR JSON Editor tab in the other group to be active', () =>
        isCustom(activeTab()),
      );
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.One);
      assert.equal(tabsFor(long).filter(isText).length, 1, 'the text tab stays open');
      await expectSelected(long, '/far/deep/deeper', 'reveal in the open CHR JSON Editor tab');
      console.log('reveal: the open CHR JSON Editor tab in the other group is made active');
    }

    // "Reveal in Text Editor" from the CHR JSON Editor replaces its tab...
    {
      await closeAll();
      const document = await openCustom(long);
      const { version } = document;
      assert.equal(hooks.select(long.toString(), keyPointer), true);
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await expectOnly(long, 'text', isText);
      const place = document.getText().indexOf('"key"');
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor?.document, document);
      assert.equal(document.offsetAt(editor.selection.active), place, 'the cursor at the place');
      assert.ok(editor.selection.isEmpty, 'an empty selection');
      const line = document.positionAt(place).line;
      await waitFor('the place in view', () => lineVisible(editor, line));
      assert.equal(document.version, version, 'reveal in text: the version');
      assert.equal(document.isDirty, false, 'reveal in text: not dirty');
      console.log('reveal in text: the CHR JSON Editor tab is replaced, the cursor at the place');
    }

    // ...or makes the text tab in another group active; the context menu's item does the same.
    {
      await closeAll();
      const { document } = await openText(long, vscode.ViewColumn.Two);
      await openCustom(long, 'tree', vscode.ViewColumn.One);
      assert.equal(
        hooks.send(long.toString(), { type: 'revealInText', docVersion: 1, path: ['k110'] }),
        true,
      );
      await waitFor('the text tab in the other group to be active', () => isText(activeTab()));
      assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, vscode.ViewColumn.Two);
      assert.equal(tabsFor(long).filter(isCustom).length, 1, 'the CHR JSON Editor tab stays');
      const editor = vscode.window.activeTextEditor;
      const place = document.getText().indexOf('"k110"');
      await waitFor('the cursor at the place', () => {
        return document.offsetAt(editor.selection.active) === place;
      });
      await waitFor('the place in view', () =>
        lineVisible(editor, document.positionAt(place).line),
      );
      console.log('reveal in text: the text tab in the other group is made active');
    }

    // Criterion 9: after a syntax error, no node: S6's first message, nothing copied, no tab change.
    const broken = fixture('broken.json5');
    const brokenMessage =
      "CHR JSON Editor: can't find the node: the document is not valid JSON5 " +
      '(error at line 3, column 11). Fix it or run "Repair JSON" first.';
    {
      await closeAll();
      const { document, editor } = await openText(broken);
      putCursor(editor, document.getText().indexOf('after'));
      hooks.pathCommands();
      for (const command of [COPY_PATH, COPY_POINTER, REVEAL_IN_EDITOR]) {
        assert.equal(await copied(command), SENTINEL, `${command}: nothing copied`);
        assert.deepEqual(hooks.pathCommands(), { messages: [brokenMessage], status: [] }, command);
        assert.equal(tabsFor(broken).length, 1, `${command}: one tab`);
        assert.ok(isText(activeTab()), `${command}: the text tab stays`);
      }
      const uri = broken;
      await closeAll();
      await openCustom(uri, 'text');
      assert.equal(hooks.cursor(uri.toString(), document.getText().indexOf('after')), true);
      for (const command of [COPY_PATH, COPY_POINTER, REVEAL_IN_TEXT]) {
        assert.equal(
          await copied(command),
          SENTINEL,
          `${command} (CHR JSON Editor): nothing copied`,
        );
        assert.deepEqual(
          hooks.pathCommands(),
          { messages: [brokenMessage], status: [] },
          `${command} (CHR JSON Editor)`,
        );
        assert.equal(tabsFor(broken).length, 1, `${command}: one tab`);
        assert.ok(isCustom(activeTab()), `${command}: the CHR JSON Editor tab stays`);
      }
      console.log('no node: a syntax error before the cursor shows S6 and changes nothing');
    }

    // Criterion 9: a node removed by an edit between the selection and "Reveal in Text Editor".
    // The library drops a selection whose node an external edit removed (the palette command then
    // names the root), so the stale path comes from the context menu: its items keep the selection
    // the menu opened on, and an edit can land while it is open (plan 018 risk R5).
    {
      await closeAll();
      const uri = fixture('sample.json');
      const document = await openCustom(uri);
      assert.equal(hooks.select(uri.toString(), '/count'), true);
      const start = document.getText().indexOf('  "count": 2,\n');
      const edit = new vscode.WorkspaceEdit();
      edit.delete(
        uri,
        new vscode.Range(
          document.positionAt(start),
          document.positionAt(start + '  "count": 2,\n'.length),
        ),
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await probeUntil(
        uri,
        'the edit in the editor',
        (p) => !JSON.stringify(p.content).includes('count'),
      );
      hooks.pathCommands();
      const path = ['count'];
      assert.equal(hooks.send(uri.toString(), { type: 'revealInText', docVersion: 1, path }), true);
      await waitFor('S6 for the removed node', () => {
        const { messages } = hooks.pathCommands();
        if (messages.length === 0) return false;
        assert.deepEqual(messages, [
          "CHR JSON Editor: can't find the node: $.count is not in the document.",
        ]);
        return true;
      });
      assert.equal(tabsFor(uri).length, 1, 'one tab');
      assert.ok(isCustom(activeTab()), 'the CHR JSON Editor tab stays');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await waitFor('the edit to revert', () => !document.isDirty);
      console.log('no node: a node removed since the selection shows S6');
    }

    // "Reveal in Text Editor" from a tab with unsaved edits: "Reopen as Text" keeps that tab open
    // beside the text tab it opens, and the cursor still lands at the place (018 T3 review, L4).
    {
      await closeAll();
      const document = await openCustom(long);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(long, document.positionAt(document.getText().lastIndexOf('}')), ' ');
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await waitFor('the document to be dirty', () => document.isDirty);
      await probeUntil(long, 'the edit in the editor', (p) => p.mode === 'tree' && !!p.content);
      assert.equal(hooks.select(long.toString(), keyPointer), true);
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await waitFor('the text tab to be active', () => isText(activeTab()));
      assert.equal(tabsFor(long).filter(isCustom).length, 1, 'the dirty CHR JSON Editor tab stays');
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor?.document, document);
      const place = document.getText().indexOf('"key"');
      await waitFor('the cursor at the place', () => {
        return document.offsetAt(editor.selection.active) === place;
      });
      await waitFor('the place in view', () =>
        lineVisible(editor, document.positionAt(place).line),
      );
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await waitFor('the edit to revert', () => !document.isDirty);
      console.log('reveal in text: from a tab with unsaved edits, the cursor at the place');
    }

    // Criterion 10, JSON Lines: the item's index first, blank lines not counted.
    const lines = fixture('lines.jsonl');
    const linesCases = CASES['lines.jsonl'];
    {
      await closeAll();
      const { document, editor } = await openText(lines);
      const text = document.getText();
      for (const { at, after = 0, jsonpath, pointer } of linesCases.text) {
        const offset = text.indexOf(at) + after;
        assert.ok(offset >= after, `lines.jsonl: ${JSON.stringify(at)} is in the fixture`);
        putCursor(editor, offset);
        await expectCopies(`lines.jsonl text editor at ${offset}`, document, jsonpath, pointer);
      }
      // A bad line: S6's first message with that line, nothing copied, no tab change.
      const { at, line, column } = linesCases.bad;
      putCursor(editor, text.indexOf(at));
      const message =
        "CHR JSON Editor: can't find the node: the document is not valid JSON Lines " +
        `(error at line ${line}, column ${column}). Fix it or run "Repair Lines" first.`;
      hooks.pathCommands();
      for (const command of [COPY_PATH, COPY_POINTER, REVEAL_IN_EDITOR]) {
        assert.equal(await copied(command), SENTINEL, `lines.jsonl ${command}: nothing copied`);
        assert.deepEqual(hooks.pathCommands(), { messages: [message], status: [] }, command);
        assert.equal(tabsFor(lines).length, 1, `lines.jsonl ${command}: one tab`);
        assert.ok(isText(activeTab()), `lines.jsonl ${command}: the text tab stays`);
      }
      assert.equal(document.isDirty, false, 'lines.jsonl: not dirty');
      console.log('copy path: lines.jsonl in the text editor, blank lines and a bad line');
    }

    // ...in the CHR JSON Editor's Table mode, the cell selected as a click selects it.
    {
      await closeAll();
      const document = await openCustom(lines, 'table');
      for (const { select, jsonpath, pointer } of linesCases.table) {
        await selectCell(lines, select);
        await expectCopies(`lines.jsonl table ${select}`, document, jsonpath, pointer);
      }
      console.log('copy path: lines.jsonl in Table mode');
    }

    // ...and both reveals land on the same item and member.
    {
      await closeAll();
      const { document, editor } = await openText(lines);
      const { version } = document;
      putCursor(editor, document.getText().indexOf('"year":1906'));
      await vscode.commands.executeCommand(REVEAL_IN_EDITOR);
      await expectOnly(lines, 'custom', isCustom);
      const cell = `.jse-table-mode td[data-path="${encodeURIComponent('/1/year')}"] .jse-value-outer`;
      await hooks.dom(lines.toString(), [{ waitFor: `${cell}.jse-selected-value` }]);
      hooks.pathCommands();
      assert.equal(await copied(COPY_POINTER), '/1/year', 'the revealed cell is the current node');

      await selectCell(lines, '/2/name');
      await vscode.commands.executeCommand(REVEAL_IN_TEXT);
      await expectOnly(lines, 'text', isText);
      const place = document.getText().indexOf('"name":"Barbara"');
      const shown = vscode.window.activeTextEditor;
      assert.equal(shown?.document, document);
      assert.equal(document.offsetAt(shown.selection.active), place, 'the cursor at the place');
      assert.equal(document.version, version, 'lines.jsonl reveals: the version');
      assert.equal(document.isDirty, false, 'lines.jsonl reveals: not dirty');
      console.log('reveal: lines.jsonl, both ways on the same item and member');
    }
  } finally {
    await closeAll();
  }
};
