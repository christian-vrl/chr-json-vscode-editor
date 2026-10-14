// Gate for 012 T6 (spec 012 criteria 10 and 11), run by suite.cjs inside VS Code. JSON Lines on a
// 6 MiB fixture, above spec 008's threshold, and on a small one. The fixtures are generated in
// run.mjs's scratch folder.
// - Criterion 10: a large JSON Lines file opens locked in large-file mode, in Table mode with Table
//   and Tree only, under 008's banner; it refuses a patch, shows an external edit, and "Edit anyway"
//   edits, saves and undoes (008 criteria 2–4). Core keeps no parse of its text (008 criterion 8).
//   With bad lines both banners show, the tab shows the items of the other lines, "Edit anyway" is
//   disabled until no bad line is left, "Open as Text" puts the cursor on the first bad line, and
//   "Repair Lines" repairs them as one edit, after which the tab is still locked and "Edit anyway"
//   unlocks it. Above the ceiling, 008 criterion 9's message.
// - Criterion 11: "Export to CSV…" in a JSON Lines tab exports the items (table mode, the root
//   array), from the text editor too, and from a locked tab with no parse kept; "Import CSV…" →
//   "Replace Document Data" replaces the items so the lines of unchanged items keep their bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const EXPORT = 'chrJsonEditor.exportCsv';
const IMPORT = 'chrJsonEditor.importCsv';
const SIX_MIB = 6 * 1024 * 1024;
const CEILING = 50 * 1024 * 1024;
const BAD_LINES = '[role="region"][aria-label="Bad lines"]';
const LARGE_FILE = '[role="region"][aria-label="Large file"]';
/** Long enough for a wrong edit to have landed: one message round trip and more. */
const SETTLE_MS = 500;

/**
 * A JSON Lines text of exactly `bytes` ASCII bytes: `{"id":0,"marker":"start"}`, then one record
 * per line, the last one padded with spaces before its line ending (spaces around a value are
 * allowed, L1). `bad` maps 1-based line numbers to the text written there instead.
 */
function linesText(bytes, bad = {}) {
  const lines = ['{"id":0,"marker":"start"}'];
  let size = lines[0].length + 1;
  for (let i = 1; ; i++) {
    const line = bad[i + 1] ?? `{"id":${i},"name":"row ${i}","tags":["a","b"]}`;
    if (size + line.length + 1 > bytes - 64) break;
    lines.push(line);
    size += line.length + 1;
  }
  const last = '{"id":-1}';
  const text = `${lines.join('\n')}\n${last}${' '.repeat(bytes - size - last.length - 1)}\n`;
  assert.equal(Buffer.byteLength(text), bytes);
  return { text, lines: lines.length + 1 };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const isCsvPanel = (tab) =>
  tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('chrJsonEditor.csv');

exports.runJsonLinesLargeFile = async function runJsonLinesLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const work = fs.mkdtempSync(path.join(scratch, 'json-lines-large-'));
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());
  const dom = (uri, steps) => hooks.dom(uri.toString(), steps);

  /** Writes `text` to a new folder as `name`. */
  function write(name, text) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), name);
    fs.writeFileSync(file, text);
    return { file, uri: vscode.Uri.file(file) };
  }

  async function probeUntil(uri, what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        const rest = { ...probe, content: probe.content && '(omitted)' };
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(rest)}`);
      }
      await sleep(200);
    }
  }

  /** The first table rows shown, as "<row> <id>" pairs: table mode's text reads `<row> <id> …` per
   *  row (the editor holds the document as text, so its rows are read from the page). */
  const rows = (probe) =>
    [...probe.shownText.matchAll(/(\d+) (-?\d+)\s+(?:start|outer|edited|row \d+)/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );

  /** Opens `uri` in CHR JSON Editor and waits until table mode shows the document's items. */
  async function open(
    uri,
    how = () => vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE),
  ) {
    const document = await vscode.workspace.openTextDocument(uri);
    await how();
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${path.basename(uri.fsPath)} webview`, () => view(uri)?.scriptLoaded, 60000);
    await probeUntil(
      uri,
      'the items in table mode',
      // Row 1 is shown: the table holds the items.
      (p) => p.mode === 'table' && p.content !== null && /\b1 \S/.test(p.shownText),
    );
    return document;
  }

  /** A banner's text. */
  async function banner(uri, selector) {
    const [shown] = await dom(uri, [{ read: `${selector} span` }]);
    return shown.replace(/\s+/g, ' ').trim();
  }

  /** Core keeps no parse of the document's text (008 criterion 8). */
  function noParseKept(document, when) {
    assert.ok(!hooks.cachedParses().includes(document.getText()), `core keeps a parse ${when}`);
  }

  /** Runs `command` and waits for the CSV panel it opens to load and show its source. */
  async function panelFrom(command, ...args) {
    const before = hooks.csvs().length;
    const panel = await vscode.commands.executeCommand(command, ...args);
    assert.ok(panel, `${command} opened no panel: ${JSON.stringify(hooks.csv(undefined))}`);
    await waitFor(`${command}'s panel`, () => hooks.csvs().length > before);
    const snapshot = hooks.csvs().at(-1);
    await waitFor(`${snapshot.title}: the page to load`, () => snapshot.scriptLoaded, 30000);
    await waitFor(`${snapshot.title}: the panel tab`, () => isCsvPanel(activeTab()));
    const deadline = Date.now() + 10000;
    for (;;) {
      const probe = await hooks.probeCsv(snapshot.title);
      if (probe.heading !== '' && probe.buttons.length > 0) return { snapshot, probe };
      if (Date.now() > deadline) throw new Error(`${snapshot.title}: the page shows no source`);
      await sleep(50);
    }
  }

  async function closePanel(snapshot) {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor('the CSV panel to close', () => !snapshot.open);
  }

  /** Clicks `label` in the CSV panel and waits for the write it makes. */
  async function clickAndWait(snapshot, label) {
    const before = snapshot.writes.length;
    await hooks.domCsv(snapshot.title, [
      { click: '.csv .actions button:not([disabled])', text: label },
    ]);
    await waitFor(`${snapshot.title}: ${label}`, () => snapshot.writes.length > before, 30000);
  }

  try {
    // Criterion 10 with no bad line: 008 criteria 2–4 and 8 on a locked 6 MiB JSON Lines tab.
    {
      await closeAll();
      const fixture = linesText(SIX_MIB);
      const { file, uri } = write('six.jsonl', fixture.text);
      const key = uri.toString();
      const document = await open(uri);
      assert.deepEqual(view(uri).largeFile, { bytes: SIX_MIB, unlocked: false });
      assert.equal(await banner(uri, LARGE_FILE), 'Large file (6.0 MiB): read-only to stay fast.');
      await dom(uri, [{ waitFor: BAD_LINES, gone: true }]);
      const [modes] = await dom(uri, [{ readAll: '[role="group"][aria-label="Mode"] button' }]);
      assert.deepEqual(JSON.parse(modes), ['Table', 'Tree']);
      const probe = await hooks.probe(key);
      assert.deepEqual(rows(probe).slice(0, 3), ['0 0', '1 1', '2 2']);
      assert.match(probe.shownText, /\b0 0\s+start\b/);
      noParseKept(document, 'after open');
      await waitFor('the badge', () => hooks.formatBadge().uri === key);
      assert.equal(hooks.formatBadge().text, 'JSON Lines');
      assert.deepEqual(hooks.formatBadge().state.outcome, {
        kind: 'parsed',
        errors: 0,
        warnings: 0,
      });
      noParseKept(document, 'after the badge');

      // 008 criterion 2: a patch sends no edit.
      const version = document.version;
      assert.equal(hooks.patch(key, [{ op: 'replace', path: '/0/marker', value: 'x' }]), true);
      await sleep(SETTLE_MS);
      assert.equal(view(uri).editsReceived, 0, 'a locked tab sent an edit');
      assert.equal(document.version, version);

      // 008 criterion 5: an external edit shows, and nothing is echoed back.
      const offset = fixture.text.indexOf('start');
      const external = new vscode.WorkspaceEdit();
      external.replace(
        uri,
        new vscode.Range(document.positionAt(offset), document.positionAt(offset + 5)),
        'outer',
      );
      assert.ok(await vscode.workspace.applyEdit(external));
      await probeUntil(uri, 'the external edit', (p) => /\b0 0\s+outer\b/.test(p.shownText));
      await sleep(SETTLE_MS);
      assert.equal(view(uri).editsReceived, 0, 'the external edit was echoed back');
      noParseKept(document, 'after an external edit');
      await document.save();

      // 008 criterion 4: "Edit anyway" edits, saves and undoes.
      const before = document.getText();
      await dom(uri, [{ click: `${LARGE_FILE} button`, text: 'Edit anyway' }]);
      await waitFor('the unlock', () => view(uri).largeFile.unlocked);
      assert.equal(await banner(uri, LARGE_FILE), 'Large file (6.0 MiB): edits may be slow.');
      const expected = before.replace('"marker":"outer"', '"marker":"edited"');
      assert.equal(hooks.patch(key, [{ op: 'replace', path: '/0/marker', value: 'edited' }]), true);
      await waitFor('the edit', () => document.getText() !== before, 30000);
      assert.equal(document.getText(), expected, 'the edit did not give the expected bytes');
      await waitFor('the document to be dirty', () => document.isDirty);
      await vscode.commands.executeCommand('workbench.action.files.save');
      await waitFor('the save', () => !document.isDirty);
      assert.ok(fs.readFileSync(file, 'utf8') === expected, 'the saved bytes differ');
      await vscode.commands.executeCommand('undo');
      await waitFor('the undo', () => document.getText() === before, 30000);
      await document.save();
      console.log('criterion 10: a large JSON Lines file is locked, keeps no parse and unlocks');

      // 008 criterion 3: "Open as Text" opens the text editor on the same bytes.
      await closeAll();
      await open(uri);
      await dom(uri, [{ click: `${LARGE_FILE} button`, text: 'Open as Text' }]);
      await expectOnly(uri, 'text', isText);
      assert.equal(document.isDirty, false);
      await closeAll();
    }

    // Criterion 10 with bad lines: both banners, the other lines' items, "Edit anyway" disabled
    // until "Repair Lines" leaves no bad line.
    {
      // Line 2 is half a record and line 5 two values: Repair Lines closes the first and cannot
      // repair the second (L10), so a second repair is needed after an edit in the text editor.
      const fixture = linesText(SIX_MIB, { 2: '{"id":1,"name":"cut', 5: '{"a":1} {"b":2}' });
      const { uri } = write('bad.ndjson', fixture.text);
      const key = uri.toString();
      const document = await open(uri, () => vscode.commands.executeCommand(OPEN_COMMAND, uri));
      assert.deepEqual(view(uri).largeFile, { bytes: SIX_MIB, unlocked: false });
      assert.equal(await banner(uri, LARGE_FILE), 'Large file (6.0 MiB): read-only to stay fast.');
      assert.equal(await banner(uri, BAD_LINES), 'Line 2 is not valid JSON (2 bad lines).');
      const [buttons] = await dom(uri, [{ readAll: `${BAD_LINES} button` }]);
      assert.deepEqual(JSON.parse(buttons), ['Open as Text', 'Repair Lines']);
      const probe = await hooks.probe(key);
      // Rows 0–3 hold ids 0, 2, 3 and 5: lines 2 and 5 are bad.
      assert.deepEqual(rows(probe).slice(0, 4), ['0 0', '1 2', '2 3', '3 5']);
      noParseKept(document, 'after open with bad lines');
      await waitFor('the badge', () => hooks.formatBadge().uri === key);
      assert.equal(hooks.formatBadge().text, '$(error) JSON Lines');
      noParseKept(document, 'after the badge with bad lines');

      // "Edit anyway" is disabled, and clicking it unlocks nothing.
      const [disabled] = await dom(uri, [
        { read: `${LARGE_FILE} button`, text: 'Edit anyway', attr: 'disabled' },
      ]);
      assert.notEqual(disabled, null, '"Edit anyway" is enabled with bad lines');
      await dom(uri, [{ click: `${LARGE_FILE} button`, text: 'Edit anyway' }]);
      await sleep(SETTLE_MS);
      assert.equal(view(uri).largeFile.unlocked, false, '"Edit anyway" unlocked a bad-line tab');

      // "Open as Text" from the bad-line banner: the cursor at the start of line 2, no full parse.
      await dom(uri, [{ click: `${BAD_LINES} button`, text: 'Open as Text' }]);
      await expectOnly(uri, 'text', isText);
      const editor = () => vscode.window.activeTextEditor;
      await waitFor('the cursor on the first bad line', () => {
        const at = editor()?.selection.active;
        return editor()?.document === document && at?.line === 1 && at.character === 0;
      });
      noParseKept(document, 'after "Open as Text"');

      // "Repair Lines" on the locked tab: one edit; line 5 stays bad, and the tab stays locked.
      await open(uri, () => vscode.commands.executeCommand(OPEN_COMMAND));
      const original = document.getText();
      await dom(uri, [{ click: `${BAD_LINES} button`, text: 'Repair Lines' }]);
      await waitFor('the repair', () => document.getText() !== original, 30000);
      assert.ok(
        document.getText() === original.replace('"name":"cut\n', '"name":"cut"}\n'),
        'Repair Lines changed more than line 2',
      );
      await dom(uri, [
        { waitFor: '.notice', text: 'Repair Lines could not repair line 5.' },
        { waitFor: `${BAD_LINES} span`, text: 'Line 5 is not valid JSON (1 bad line).' },
      ]);
      assert.equal(view(uri).largeFile.unlocked, false, 'the repair unlocked the tab');
      noParseKept(document, 'after Repair Lines');
      // One undo restores the text; redo brings the repair back.
      await vscode.commands.executeCommand('undo');
      await waitFor('the undo of the repair', () => document.getText() === original, 30000);
      await dom(uri, [
        { waitFor: `${BAD_LINES} span`, text: 'Line 2 is not valid JSON (2 bad lines).' },
      ]);
      await vscode.commands.executeCommand('redo');
      await waitFor('the redo of the repair', () => document.getText() !== original, 30000);

      // An edit made elsewhere fixes line 5: the bad-line banner goes and "Edit anyway" unlocks.
      const text = document.getText();
      const at = text.indexOf('{"a":1} {"b":2}');
      const fix = new vscode.WorkspaceEdit();
      fix.replace(
        uri,
        new vscode.Range(document.positionAt(at), document.positionAt(at + 15)),
        '{"a":1}',
      );
      assert.ok(await vscode.workspace.applyEdit(fix));
      await dom(uri, [{ waitFor: BAD_LINES, gone: true }]);
      await probeUntil(uri, 'every item', (p) => /\b1 1\s+cut\b/.test(p.shownText));
      const [enabled] = await dom(uri, [
        { read: `${LARGE_FILE} button`, text: 'Edit anyway', attr: 'disabled' },
      ]);
      assert.equal(enabled, null, '"Edit anyway" stays disabled with no bad line');
      assert.equal(view(uri).largeFile.unlocked, false);
      await dom(uri, [{ click: `${LARGE_FILE} button`, text: 'Edit anyway' }]);
      await waitFor('the unlock', () => view(uri).largeFile.unlocked);
      const before = document.version;
      assert.equal(hooks.patch(key, [{ op: 'remove', path: '/0' }]), true);
      await waitFor('an edit after the unlock', () => document.version > before, 30000);
      assert.ok(document.getText().startsWith('{"id":1,"name":"cut"}\n'), 'the edit after unlock');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
      console.log(
        'criterion 10: bad lines show both banners and the other items; Repair Lines runs ' +
          'locked; Edit anyway waits for no bad line',
      );
    }

    // Criterion 10: above the ceiling, 008 criterion 9's message (the size on disk decides, so a
    // sparse file is enough).
    {
      const { file, uri } = write('over.jsonl', '');
      fs.truncateSync(file, CEILING + 1);
      hooks.ceiling(false);
      await vscode.commands.executeCommand(OPEN_COMMAND, uri);
      assert.deepEqual(hooks.ceiling(undefined), [
        'over.jsonl is 50.0 MiB. VS Code does not pass files above 50 MB to extensions, so CHR ' +
          "JSON Editor can't open it.",
      ]);
      console.log('criterion 10: a JSON Lines file above the ceiling gets the message');
    }

    // Criterion 11: "Export to CSV…" is offered for JSON Lines in the text editor too.
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    for (const menu of ['commandPalette', 'editor/title']) {
      const { when } = manifest.contributes.menus[menu].find((m) => m.command === EXPORT);
      const formats = new RegExp(/textEditorFormat =~ \/(.*?)\//.exec(when)[1]);
      assert.match('jsonl', formats, `${menu}: ${when}`);
    }

    // Criterion 11: "Export to CSV…" from a locked large tab: every item, no parse kept.
    {
      await closeAll();
      const { text, lines } = linesText(SIX_MIB);
      const { uri } = write('export.jsonl', text);
      const document = await open(uri);
      const { snapshot } = await panelFrom(EXPORT);
      assert.deepEqual([snapshot.source.pointer, snapshot.source.rowCount], ['', lines]);
      noParseKept(document, 'after the export');
      await closePanel(snapshot);
      await closeAll();
    }

    // Criterion 11 on a small JSON Lines file: export from table mode and from the text editor,
    // and "Replace Document Data" keeps the lines of unchanged items byte for byte.
    {
      const before = '{ "name" : "Ada", "year" : 1843 }\n\n{"name":"Grace","year":1959}\n';
      const { file, uri } = write('people.jsonl', before);
      const document = await open(uri);
      let { snapshot, probe } = await panelFrom(EXPORT);
      assert.deepEqual([snapshot.source.pointer, snapshot.source.rowCount], ['', 2]);
      assert.equal(snapshot.title, 'Export people.jsonl to CSV');
      assert.equal(probe.csv, 'name,year\r\nAda,1843\r\nGrace,1959\r\n');
      await closePanel(snapshot);
      await closeAll();

      await vscode.window.showTextDocument(document);
      await expectOnly(uri, 'text', isText);
      ({ snapshot, probe } = await panelFrom(EXPORT));
      assert.deepEqual([snapshot.source.pointer, snapshot.source.rowCount], ['', 2]);
      assert.equal(probe.csv, 'name,year\r\nAda,1843\r\nGrace,1959\r\n');
      await closePanel(snapshot);
      await closeAll();

      const csv = write('data.csv', 'name,year\r\nAda,1843\r\nGrace,1960\r\nBarbara,1939\r\n');
      await open(uri);
      hooks.csv({ pick: () => csv.uri.toString() });
      ({ snapshot, probe } = await panelFrom(IMPORT));
      hooks.csv(undefined);
      assert.deepEqual(
        probe.buttons.map((b) => b.label),
        ['Create JSON File', 'Replace Document Data'],
      );
      await clickAndWait(snapshot, 'Replace Document Data');
      assert.deepEqual(snapshot.writes, [`replaceData ${uri.toString()}`]);
      assert.equal(
        document.getText(),
        '{ "name" : "Ada", "year" : 1843 }\n\n{"name":"Grace","year":1960}\n' +
          '{"name":"Barbara","year":1939}\n',
        'Replace Document Data rewrote unchanged lines',
      );
      assert.equal(document.isDirty, true);
      assert.equal(fs.readFileSync(file, 'utf8'), before);
      await vscode.window.showTextDocument(document);
      await waitFor('the text editor', () => isText(activeTab()));
      await vscode.commands.executeCommand('undo');
      await waitFor('one undo', () => document.getText() === before);
      await closeAll();
      console.log('criterion 11: CSV export and Replace Document Data on JSON Lines');
    }
  } finally {
    hooks.csv(undefined);
    hooks.ceiling(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
