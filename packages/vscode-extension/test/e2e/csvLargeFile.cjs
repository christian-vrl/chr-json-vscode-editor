// Gate for 009 T5 (spec 009 criterion 10), run by suite.cjs inside VS Code on a 6 MiB JSON file,
// which opens locked in spec 008's large-file mode (above the 5 MiB threshold):
// - "Import CSV…" is not offered in the locked tab (palette and editor title: the
//   `chrJsonEditor.customEditorLocked` context key), and run anyway it says why and opens nothing;
// - an import panel already open on the document drops "Replace Document Data" when a tab opens
//   it locked, and gets it back after "Edit anyway", keeping the options chosen;
// - "Export to CSV…" and "Convert CSV to JSON" stay; export from the locked tab reads the data with
//   `parseData`, so core's parse cache holds no parse of the document afterwards (008 criterion 8's
//   hook), and writes every row;
// - after "Edit anyway", "Import CSV…" opens the panel with "Replace Document Data" and export
//   works like any other.
// The fixtures are written into run.mjs's scratch folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const EXPORT = 'chrJsonEditor.exportCsv';
const IMPORT = 'chrJsonEditor.importCsv';
const CONVERT = 'chrJsonEditor.convertCsvToJson';
const LOCKED_KEY = 'chrJsonEditor.customEditorLocked';
const SIX_MIB = 6 * 1024 * 1024;
const CSV = path.resolve(__dirname, '../../../../tests/csv');
const LOCKED_IMPORT_MESSAGE =
  'CHR JSON Editor: this large file is read-only. Choose "Edit anyway" to import CSV into it.';

/** A JSON array of `{id, name, tags}` rows, padded with spaces to exactly 6 MiB; and the CSV
 *  `jsonToCsv` writes for it with the export defaults (X1–X7: arrays as JSON text, quoted). */
function bigFixture() {
  const rows = [];
  const csv = ['id,name,tags\r\n'];
  let size = 4; // "[\n" and "]\n"
  for (let i = 0; ; i++) {
    const row = `  {"id": ${i}, "name": "row ${i}", "tags": ["a", "b"]}`;
    if (size + row.length + 2 > SIX_MIB - 64) break;
    rows.push(row);
    csv.push(`${i},row ${i},"[""a"",""b""]"\r\n`);
    size += row.length + 2;
  }
  const body = `[\n${rows.join(',\n')}`;
  const text = `${body}${' '.repeat(SIX_MIB - body.length - 3)}\n]\n`;
  assert.equal(Buffer.byteLength(text), SIX_MIB);
  return { text, rows: rows.length, csv: csv.join('') };
}

function isCsvPanel(tab) {
  return (
    tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('chrJsonEditor.csv')
  );
}

const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.runCsvLargeFile = async function runCsvLargeFile({ hooks, waitFor, closeAll, isCustom }) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const work = fs.mkdtempSync(path.join(scratch, 'csv-large-'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  /** Runs `command` and waits for the panel it opens to load and show its source. */
  async function panelFrom(command, ...args) {
    const before = hooks.csvs().length;
    const panel = await vscode.commands.executeCommand(command, ...args);
    assert.ok(panel, `${command} opened no panel: ${JSON.stringify(hooks.csvSeen())}`);
    await waitFor(`${command}'s panel`, () => hooks.csvs().length > before);
    const snapshot = hooks.csvs().at(-1);
    await waitFor(`${snapshot.title}: the page to load`, () => snapshot.scriptLoaded, 30000);
    await waitFor(`${snapshot.title}: the panel tab`, () => isCsvPanel(activeTab()));
    await buttonsOf(snapshot.title, (labels) => labels.length > 0);
    return snapshot;
  }

  /** Waits until the page of the CSV panel `title` shows buttons that `predicate` accepts. */
  async function buttonsOf(title, predicate) {
    const deadline = Date.now() + 10000;
    for (;;) {
      const labels = (await hooks.probeCsv(title)).buttons.map((b) => b.label);
      if (predicate(labels)) return labels;
      if (Date.now() > deadline)
        throw new Error(`${title}: buttons stay ${JSON.stringify(labels)}`);
      await sleep(100);
    }
  }

  const click = (title, label) =>
    hooks.domCsv(title, [{ click: '.csv .actions button:not([disabled])', text: label }]);

  /** Clicks `label` and waits for the write it makes. */
  async function clickAndWait(snapshot, label) {
    const before = snapshot.writes.length;
    await click(snapshot.title, label);
    await waitFor(`${snapshot.title}: ${label}`, () => snapshot.writes.length > before, 30000);
  }

  /** Brings the CHR JSON Editor tab of `uri` to the front and waits for its tree. */
  async function showEditor(uri) {
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await waitFor('the CHR JSON Editor tab', () => isCustom(activeTab()));
    const deadline = Date.now() + 60000;
    for (;;) {
      const probe = await hooks.probe(uri.toString());
      if (probe.mode === 'tree' && probe.content) return;
      if (Date.now() > deadline) throw new Error(`${path.basename(uri.fsPath)}: no tree`);
      await sleep(200);
    }
  }

  try {
    // The menus: "Import CSV…" leaves the palette and the editor title of a locked tab; "Export to
    // CSV…" and "Convert CSV to JSON" keep their entries (009 T4's conditions, csv.cjs).
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const entry = (menu, command) =>
      manifest.contributes.menus[menu].find((m) => m.command === command)?.when ?? '';
    for (const menu of ['commandPalette', 'editor/title']) {
      assert.ok(entry(menu, IMPORT).includes(`!${LOCKED_KEY}`), `${menu}: ${entry(menu, IMPORT)}`);
      assert.ok(!entry(menu, EXPORT).includes(LOCKED_KEY), `${menu}: ${entry(menu, EXPORT)}`);
      assert.ok(!entry(menu, CONVERT).includes(LOCKED_KEY), `${menu}: ${entry(menu, CONVERT)}`);
    }

    const big = bigFixture();
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), 'big.json');
    fs.writeFileSync(file, big.text);
    const uri = vscode.Uri.file(file);
    const csvFile = path.join(fs.mkdtempSync(path.join(work, 'case-')), 'people.csv');
    fs.copyFileSync(path.join(CSV, 'import/people.csv'), csvFile);
    hooks.csv({ pick: () => vscode.Uri.file(csvFile).toString() });

    // An import panel opened on the document from the text editor offers "Replace Document Data".
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const imported = await panelFrom(IMPORT, uri);
    assert.equal(imported.source.canReplace, true);
    await buttonsOf(imported.title, (b) => b.includes('Replace Document Data'));
    await hooks.domCsv(imported.title, [{ select: '.csv .options select', value: ';' }]);

    // The document opens in CHR JSON Editor, locked: the panel drops "Replace Document Data".
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await waitFor('the big.json webview', () => view(uri)?.scriptLoaded, 60000);
    assert.deepEqual(view(uri).largeFile, { bytes: SIX_MIB, unlocked: false });
    await showEditor(uri);
    await waitFor('the locked context key', () => hooks.csvLocked() === true);
    await waitFor('the panel to follow the lock', () => imported.source.canReplace === false);
    assert.deepEqual(await buttonsOf(imported.title, (b) => !b.includes('Replace Document Data')), [
      'Create JSON File',
    ]);
    hooks.csvSeen();

    // "Import CSV…" run anyway in the locked tab: a message, no panel.
    let before = hooks.csvs().length;
    assert.equal(await vscode.commands.executeCommand(IMPORT), undefined);
    assert.deepEqual(hooks.csvSeen().messages, [LOCKED_IMPORT_MESSAGE]);
    assert.equal(hooks.csvs().length, before, 'Import CSV… opened a panel in a locked tab');

    // "Export to CSV…" from the locked tab: every row, and no full parse left in core's cache.
    const text = document.getText();
    assert.ok(!hooks.cachedParses().includes(text), 'core keeps a parse before the export');
    const exported = await panelFrom(EXPORT);
    assert.equal(exported.title, 'Export big.json to CSV');
    assert.deepEqual([exported.source.pointer, exported.source.rowCount], ['', big.rows]);
    assert.deepEqual(
      (await hooks.probeCsv(exported.title)).buttons.map((b) => b.label),
      ['Save CSV…', 'Copy CSV'],
    );
    await clickAndWait(exported, 'Save CSV…');
    const saved = path.join(path.dirname(file), 'big.csv');
    assert.deepEqual(exported.writes, [`save ${vscode.Uri.file(saved).toString()}`]);
    assert.ok(fs.readFileSync(saved, 'utf8') === big.csv, 'big.csv differs from the expected CSV');
    assert.ok(!hooks.cachedParses().includes(text), 'core keeps a parse after the export');
    assert.equal(document.isDirty, false, 'the export changed the document');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor('the export panel to close', () => !exported.open);

    // "Convert CSV to JSON" stays available.
    const converted = await panelFrom(CONVERT, vscode.Uri.file(csvFile));
    assert.deepEqual(
      (await hooks.probeCsv(converted.title)).buttons.map((b) => b.label),
      ['Create JSON File'],
    );
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor('the convert panel to close', () => !converted.open);
    console.log('CSV: a locked tab offers no Import CSV… and exports through parseData');

    // "Edit anyway": the panel gets "Replace Document Data" back, its options kept, and "Import
    // CSV…" is offered again.
    await showEditor(uri);
    await hooks.dom(uri.toString(), [{ click: '.banner button', text: 'Edit anyway' }]);
    await waitFor('the unlock', () => view(uri).largeFile.unlocked);
    await waitFor('the context key after the unlock', () => hooks.csvLocked() === false);
    await waitFor('the panel to follow the unlock', () => imported.source.canReplace === true);
    await buttonsOf(imported.title, (b) => b.includes('Replace Document Data'));
    const options = (await hooks.probeCsv(imported.title)).options;
    assert.deepEqual(options[0], { label: 'Delimiter', value: ';' }, 'the options were reset');

    before = hooks.csvs().length;
    const again = await panelFrom(IMPORT);
    assert.equal(hooks.csvs().length, before + 1);
    assert.equal(again.source.canReplace, true);
    await buttonsOf(again.title, (b) => b.includes('Replace Document Data'));
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await waitFor('the import panel to close', () => !again.open);

    // An unlocked tab exports like any other.
    await showEditor(uri);
    const unlocked = await panelFrom(EXPORT);
    assert.deepEqual([unlocked.source.pointer, unlocked.source.rowCount], ['', big.rows]);
    await vscode.env.clipboard.writeText('');
    await clickAndWait(unlocked, 'Copy CSV');
    assert.ok((await vscode.env.clipboard.readText()) === big.csv, 'the copied CSV differs');
    console.log('CSV: after "Edit anyway" Import CSV… and Replace Document Data come back');
    await closeAll();
  } finally {
    hooks.csv(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
