// Gate for 009 T4 (spec 009 criteria 4, 5, 7, 8 and the panel's CSP of criterion 9), run by
// suite.cjs inside VS Code. "Export to CSV…", "Import CSV…" and "Convert CSV to JSON" open the CSV
// panel (5); its buttons save, copy, create a JSON file opened in the CHR JSON Editor, or replace
// the document's data as one undoable edit, byte for byte as tests/csv/replace/*/expected-after.*
// (4); the row source follows table mode and tree mode's selection (7); a CSV file above the
// threshold imports in full and the JSON file it creates opens in large-file mode, one above the
// ceiling is not read, and a created JSON file above the ceiling is written and shows 008
// criterion 9's message when it opens (8). The fixtures are copied
// into run.mjs's scratch folder, so the copies never touch the repository's files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { CRITERION_6, withIndent } = require('./indent.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const EXPORT = 'chrJsonEditor.exportCsv';
const IMPORT = 'chrJsonEditor.importCsv';
const CONVERT = 'chrJsonEditor.convertCsvToJson';
const CSV = path.resolve(__dirname, '../../../../tests/csv');
/** Spec 008's threshold (UNK-014) and VS Code's sync limit, its ceiling (sizeCeiling.ts). */
const THRESHOLD = 5 * 1024 * 1024;
const CEILING = 50 * 1024 * 1024;

/** jsonToCsv of tests/csv/export/people.json with the defaults (X1–X7), and with `;`. */
const PEOPLE_CSV =
  'name,address.city,address.zip,tags,address\r\n' +
  'Ada,London,NW1,"[""math"",""poetry""]",\r\n' +
  'Grace,New York,,"[""navy""]",\r\n' +
  '"Linus, Jr.",,,[],{}\r\n';
const PEOPLE_CSV_SEMICOLON =
  'name;address.city;address.zip;tags;address\r\n' +
  'Ada;London;NW1;"[""math"",""poetry""]";\r\n' +
  'Grace;New York;;"[""navy""]";\r\n' +
  'Linus, Jr.;;;[];{}\r\n';
/** csvToJson of tests/csv/import/people.csv (`;` detected), as "Create JSON File" writes it: with
 *  VS Code's indent for JSON (spec 019 I1), 4 spaces by default. */
const PEOPLE_JSON = `${JSON.stringify(
  [
    { name: 'Ada', address: { city: 'London', zip: 'NW1' }, tags: ['math', 'poetry'] },
    { name: 'Grace', address: { city: 'New York', zip: null }, tags: ['navy', null] },
  ],
  null,
  4,
)}\n`;

function isCsvPanel(tab) {
  return (
    tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('chrJsonEditor.csv')
  );
}

function activeTab() {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 * @param {(snapshot: object) => string} t.assertCriterion6 suite.cjs's CSP check
 */
exports.runCsv = async function runCsv({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
  assertCriterion6,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const work = fs.mkdtempSync(path.join(scratch, 'csv-'));
  const isText = (tab) => tab.input instanceof vscode.TabInputText;

  /** Copies `from` (under tests/csv) into a new folder as `to`. */
  function copy(from, to = path.basename(from)) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), to);
    fs.copyFileSync(path.join(CSV, from), file);
    return file;
  }

  /** Writes `bytes` into a new folder as `name`. */
  function write(name, bytes) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), name);
    fs.writeFileSync(file, bytes);
    return file;
  }

  async function openCustom(file) {
    const uri = vscode.Uri.file(file);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the ${path.basename(file)} webview`, () => view()?.scriptLoaded);
    return uri;
  }

  async function openText(file) {
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await expectOnly(uri, 'text', isText);
    return document;
  }

  /** Runs `command` and waits for the panel it opens to load its page and source. */
  async function panelFrom(command, ...args) {
    const before = hooks.csvs().length;
    const panel = await vscode.commands.executeCommand(command, ...args);
    assert.ok(panel, `${command} opened no panel: ${JSON.stringify(hooks.csv(undefined))}`);
    await waitFor(`${command}'s panel`, () => hooks.csvs().length > before);
    const snapshot = hooks.csvs().at(-1);
    await waitFor(`${snapshot.title}: the page to load`, () => snapshot.scriptLoaded);
    await waitFor(`${snapshot.title}: the panel tab`, () => isCsvPanel(activeTab()));
    let probe;
    const deadline = Date.now() + 10000;
    for (;;) {
      probe = await hooks.probeCsv(snapshot.title);
      if (probe.heading !== '' && probe.buttons.length > 0) break;
      if (Date.now() > deadline) throw new Error(`${snapshot.title}: the page shows no source`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { snapshot, probe };
  }

  const click = (title, label) =>
    hooks.domCsv(title, [{ click: '.csv .actions button:not([disabled])', text: label }]);

  /** Clicks `label` and waits for the write it makes; on a timeout, says what the panel shows. */
  async function clickAndWait(snapshot, label) {
    const before = snapshot.writes.length;
    await click(snapshot.title, label);
    try {
      await waitFor(`${snapshot.title}: ${label}`, () => snapshot.writes.length > before);
    } catch (error) {
      const page = await hooks.probeCsv(snapshot.title);
      throw new Error(
        `${error.message}; messages ${JSON.stringify(snapshot.messages)}, page ${JSON.stringify(page)}`,
        { cause: error },
      );
    }
  }

  const lf = (text) => text.replace(/\r\n/g, '\n');

  /** Waits until the webview of `uri` renders `mode`, calling `ask` (to set it) until it does: a
   *  tab that was hidden reloads its webview, which drops a message posted meanwhile. */
  async function rendered(uri, mode, ask = () => {}) {
    const deadline = Date.now() + 10000;
    for (;;) {
      ask();
      if ((await hooks.probe(uri.toString())).mode === mode) return;
      if (Date.now() > deadline) throw new Error(`${path.basename(uri.fsPath)}: no ${mode} mode`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    // Criterion 5's entries: palette and editor titles, and the explorer for "Convert CSV to JSON".
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const titles = Object.fromEntries(manifest.contributes.commands.map((c) => [c.command, c]));
    assert.equal(titles[EXPORT]?.title, 'Export to CSV…');
    assert.equal(titles[IMPORT]?.title, 'Import CSV…');
    assert.equal(titles[CONVERT]?.title, 'Convert CSV to JSON');
    const entry = (menu, command) =>
      manifest.contributes.menus[menu].find((m) => m.command === command)?.when ?? '';
    for (const menu of ['commandPalette', 'editor/title']) {
      assert.match(entry(menu, EXPORT), /activeCustomEditorId == chrJsonEditor\.editor/);
      assert.match(entry(menu, EXPORT), /textEditorFormat =~ \/\^\(json\|jsonc\|json5\)\$\//);
      // Not in a tab locked in large-file mode (criterion 10, csvLargeFile.cjs).
      assert.equal(
        entry(menu, IMPORT),
        'activeCustomEditorId == chrJsonEditor.editor && !chrJsonEditor.customEditorLocked',
      );
    }
    assert.match(entry('editor/title', CONVERT), /resourceExtname =~ \/\^\\\.csv\$\/i/);
    assert.match(entry('explorer/context', CONVERT), /resourceExtname =~ \/\^\\\.csv\$\/i/);

    // Criterion 5 and the CSP of criterion 9: "Export to CSV…" from the text editor. The page shows
    // the defaults and the CSV; "Save CSV…" writes people.csv beside the source, then a save dialog
    // prefilled with it once it exists; "Copy CSV" puts the text on the clipboard; closing the
    // panel writes nothing, and the source never changes.
    {
      const file = copy('export/people.json');
      const source = fs.readFileSync(file, 'utf8');
      const document = await openText(file);
      const { snapshot, probe } = await panelFrom(EXPORT);
      const { title } = snapshot;
      assert.equal(title, 'Export people.json to CSV');
      assertCriterion6({ ...snapshot, uri: document.uri.toString() });
      assert.deepEqual(probe.violations, [], 'CSV page: CSP violations');
      for (const style of probe.styleElements.filter((s) => s.id !== '_defaultStyles')) {
        assert.equal(style.nonce, true, `CSV page: <style id="${style.id}"> without the nonce`);
      }
      assert.equal(probe.heading, 'Export people.json to CSV');
      assert.deepEqual(probe.options, [
        { label: 'Delimiter', value: ',' },
        { label: 'Header row', value: 'on' },
        { label: 'Flatten nested objects', value: 'on' },
        { label: 'Flatten nested arrays', value: 'off' },
        { label: 'UTF-8 BOM (for Excel)', value: 'off' },
      ]);
      assert.deepEqual(probe.buttons, [
        { label: 'Save CSV…', disabled: false },
        { label: 'Copy CSV', disabled: false },
      ]);
      assert.equal(lf(probe.csv ?? ''), lf(PEOPLE_CSV));
      assert.equal(probe.summary, '3 rows, 5 columns');

      await clickAndWait(snapshot, 'Save CSV…');
      const saved = path.join(path.dirname(file), 'people.csv');
      assert.deepEqual(snapshot.writes, [`save ${vscode.Uri.file(saved).toString()}`]);
      assert.equal(fs.readFileSync(saved, 'utf8'), PEOPLE_CSV);

      // The file exists now: the save dialog picks where, prefilled with it; the options shown go
      // with the request.
      const other = path.join(path.dirname(file), 'other.csv');
      hooks.csv({ saveAs: () => vscode.Uri.file(other).toString() });
      await hooks.domCsv(title, [{ select: '.csv .options select', value: ';' }]);
      await clickAndWait(snapshot, 'Save CSV…');
      assert.deepEqual(hooks.csv(undefined).saveAs, [vscode.Uri.file(saved).toString()]);
      assert.equal(fs.readFileSync(other, 'utf8'), PEOPLE_CSV_SEMICOLON);
      assert.equal(fs.readFileSync(saved, 'utf8'), PEOPLE_CSV);

      // Closing the dialog writes nothing.
      hooks.csv({ saveAs: () => undefined });
      await click(title, 'Save CSV…');
      await waitFor('the closed save dialog', () => hooks.csvSeen().saveAs.length === 1);
      hooks.csv(undefined);

      await vscode.env.clipboard.writeText('');
      await clickAndWait(snapshot, 'Copy CSV');
      assert.equal(await vscode.env.clipboard.readText(), PEOPLE_CSV_SEMICOLON);

      const listed = fs.readdirSync(path.dirname(file)).sort();
      assert.deepEqual(listed, ['other.csv', 'people.csv', 'people.json']);
      await closeAll();
      assert.equal(snapshot.open, false);
      assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), listed, 'closing wrote a file');
      assert.equal(fs.readFileSync(file, 'utf8'), source, 'the source file changed');
      assert.equal(document.isDirty, false, 'the source document changed');
      assert.deepEqual(snapshot.messages, [
        'CHR JSON Editor: saved people.csv.',
        'CHR JSON Editor: saved other.csv.',
      ]);
      console.log(
        'CSV: export from the text editor saves, asks where once the file exists, copies',
      );
    }

    // Criterion 7: the row source from the CHR JSON Editor. Tree mode exports the one array or
    // object selected, anything else the document's data; table mode the array it shows (the
    // document's root array), whatever tree mode had selected; text mode the document's data.
    {
      const wrapped = {
        people: JSON.parse(fs.readFileSync(path.join(CSV, 'export/people.json'), 'utf8')),
        count: 3,
      };
      const file = write('wrapped.json', `${JSON.stringify(wrapped, null, 2)}\n`);
      const uri = await openCustom(file);
      const exportWith = async (select) => {
        // The tab was behind the panel, so its webview loaded again: wait for its tree.
        await rendered(uri, 'tree');
        if (select !== undefined) assert.equal(hooks.select(uri.toString(), select), true);
        // The selection reaches the host's answer through the library's `onSelect`.
        await new Promise((resolve) => setTimeout(resolve, 200));
        const { snapshot, probe } = await panelFrom(EXPORT);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await waitFor('the CSV panel to close', () => !snapshot.open);
        await expectOnly(uri, 'custom', isCustom);
        return {
          pointer: snapshot.source.pointer,
          rows: snapshot.source.rowCount,
          probe,
          snapshot,
        };
      };
      let result = await exportWith(undefined);
      assert.deepEqual([result.pointer, result.rows], ['', 1], 'nothing selected');
      assert.equal(result.snapshot.title, 'Export wrapped.json to CSV');
      result = await exportWith('/people');
      assert.deepEqual([result.pointer, result.rows], ['/people', 3], 'an array selected');
      assert.equal(result.snapshot.title, 'Export /people of wrapped.json to CSV');
      assert.equal(result.probe.heading, 'Export /people of wrapped.json to CSV');
      assert.equal(lf(result.probe.csv ?? ''), lf(PEOPLE_CSV));
      result = await exportWith('/people/1');
      assert.deepEqual([result.pointer, result.rows], ['/people/1', 1], 'an object selected');
      result = await exportWith('/count');
      assert.deepEqual([result.pointer, result.rows], ['', 1], 'a number selected');
      result = await exportWith('/people/0/name');
      assert.deepEqual([result.pointer, result.rows], ['', 1], 'a string selected');
      await closeAll();

      // Table mode shows the root array, even with a row selected in tree mode before.
      const list = await openCustom(copy('export/people.json'));
      await rendered(list, 'tree');
      assert.equal(hooks.select(list.toString(), '/0'), true);
      const mode = (m) => rendered(list, m, () => hooks.setMode(list.toString(), m));
      await mode('table');
      let shown = await panelFrom(EXPORT);
      assert.deepEqual([shown.snapshot.source.pointer, shown.snapshot.source.rowCount], ['', 3]);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await expectOnly(list, 'custom', isCustom);
      await mode('text');
      shown = await panelFrom(EXPORT);
      assert.deepEqual([shown.snapshot.source.pointer, shown.snapshot.source.rowCount], ['', 3]);
      await closeAll();
      console.log('CSV: the row source follows tree selection and table mode');
    }

    // Criterion 7: a document whose parse has an error is not exported.
    {
      const file = write('broken.jsonc', '{\n  "a": }\n');
      await openText(file);
      const before = hooks.csvs().length;
      await vscode.commands.executeCommand(EXPORT);
      assert.deepEqual(hooks.csv(undefined).messages, [
        "CHR JSON Editor: can't export to CSV: the document is not valid JSONC (error at line 2, " +
          'column 8). Fix it or run "Repair JSON" first.',
      ]);
      assert.equal(hooks.csvs().length, before, 'a panel opened for a broken document');
      await closeAll();
    }

    // Criterion 4: "Replace Document Data" from "Import CSV…" in the CHR JSON Editor: the text
    // equals expected-after.* byte for byte, the document is dirty, and one undo restores it.
    for (const name of fs.readdirSync(path.join(CSV, 'replace')).sort()) {
      const files = fs.readdirSync(path.join(CSV, 'replace', name));
      const beforeName = files.find((f) => f.startsWith('before.'));
      const extension = path.extname(beforeName);
      const target = copy(`replace/${name}/${beforeName}`, `doc${extension}`);
      const csv = copy(`replace/${name}/data.csv`);
      const expected = fs.readFileSync(
        path.join(CSV, 'replace', name, `expected-after${extension}`),
        'utf8',
      );
      const original = fs.readFileSync(target, 'utf8');
      const uri = await openCustom(target);
      const document = await vscode.workspace.openTextDocument(uri);
      hooks.csv({ pick: () => vscode.Uri.file(csv).toString() });
      const { snapshot, probe } = await panelFrom(IMPORT);
      hooks.csv(undefined);
      assert.equal(snapshot.title, 'Import data.csv');
      assert.equal(probe.table, true, `${name}: the preview table`);
      assert.deepEqual(
        probe.buttons.map((b) => b.label),
        ['Create JSON File', 'Replace Document Data'],
      );
      await clickAndWait(snapshot, 'Replace Document Data');
      assert.deepEqual(snapshot.writes, [`replaceData ${uri.toString()}`]);
      assert.equal(document.getText(), expected, `${name}: text after the replace`);
      assert.equal(document.isDirty, true, `${name}: dirty`);
      assert.equal(fs.readFileSync(target, 'utf8'), original, `${name}: saved to disk`);
      assert.equal(fs.readFileSync(csv, 'utf8').length > 0, true);
      await vscode.window.showTextDocument(document);
      await waitFor(`${name}: the text editor`, () => isText(activeTab()));
      await vscode.commands.executeCommand('undo');
      await waitFor(`${name}: one undo`, () => document.getText() === original);
      assert.equal(document.isDirty, false, `${name}: dirty after the undo`);
      await closeAll();
      console.log(`CSV: Replace Document Data on ${name} keeps comments and undoes in one step`);
    }

    // Criterion 5: "Create JSON File" writes <name>.json beside the CSV and opens it in the CHR JSON
    // Editor; once it exists, a save dialog prefilled with it picks where. "Convert CSV to JSON"
    // from the explorer offers no "Replace Document Data".
    {
      const csv = copy('import/people.csv');
      const csvText = fs.readFileSync(csv, 'utf8');
      const { snapshot, probe } = await panelFrom(CONVERT, vscode.Uri.file(csv));
      assert.equal(snapshot.title, 'Import people.csv');
      assert.deepEqual(probe.buttons, [{ label: 'Create JSON File', disabled: false }]);
      assert.deepEqual(probe.options, [
        { label: 'Delimiter', value: 'detect' },
        { label: 'Header row', value: 'on' },
        { label: 'Nested objects from field names', value: 'on' },
      ]);
      await clickAndWait(snapshot, 'Create JSON File');
      const created = path.join(path.dirname(csv), 'people.json');
      assert.equal(fs.readFileSync(created, 'utf8'), PEOPLE_JSON);
      await expectOnly(vscode.Uri.file(created), 'custom', isCustom);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor('the CSV panel again', () => isCsvPanel(activeTab()));
      hooks.csv({ saveAs: () => undefined });
      await click(snapshot.title, 'Create JSON File');
      await waitFor('the save dialog', () => hooks.csvSeen().saveAs.length === 1);
      hooks.csv(undefined);
      assert.deepEqual(fs.readdirSync(path.dirname(csv)).sort(), ['people.csv', 'people.json']);
      assert.equal(fs.readFileSync(csv, 'utf8'), csvText, 'the CSV file changed');
      await closeAll();

      // Spec 019 criterion 6: the new file takes "[json]"'s indent, 4 spaces or a tab.
      for (const [values, unit] of CRITERION_6) {
        await withIndent(waitFor, ['json'], values, async () => {
          const source = copy('import/people.csv');
          const panel = await panelFrom(CONVERT, vscode.Uri.file(source));
          await clickAndWait(panel.snapshot, 'Create JSON File');
          const json = path.join(path.dirname(source), 'people.json');
          assert.equal(
            fs.readFileSync(json, 'utf8'),
            PEOPLE_JSON.replace(/^(?: {4})+/gm, (s) => unit.repeat(s.length / 4)),
            `Create JSON File with ${JSON.stringify(values)}`,
          );
          await closeAll();
        });
      }
      console.log('criterion 6: "Create JSON File" writes "[json]"\'s 4 spaces or a tab');

      // From the editor title of a .csv file in the text editor, and an error preview.
      const broken = copy('import/open-quote.csv');
      await openText(broken);
      const shown = await panelFrom(CONVERT);
      assert.equal(shown.snapshot.title, 'Import open-quote.csv');
      assert.match(shown.probe.error ?? '', /^Line 3: /);
      assert.deepEqual(shown.probe.buttons, [{ label: 'Create JSON File', disabled: true }]);
      await closeAll();
      console.log('CSV: Create JSON File opens the new file; Convert CSV to JSON from both menus');
    }

    // Criterion 8: above the threshold a CSV file imports in full; above the ceiling it is not read;
    // a created JSON file above the ceiling is still written and shows 008 criterion 9's message.
    {
      const rows = [];
      let size = 0;
      for (let i = 0; size <= THRESHOLD + 1024 * 1024; i++) {
        const row = `${i},row number ${i} of the large file,${i % 2 === 0}\r\n`;
        rows.push(row);
        size += row.length;
      }
      const big = write('big.csv', `id,label,even\r\n${rows.join('')}`);
      const { snapshot, probe } = await panelFrom(CONVERT, vscode.Uri.file(big));
      assert.equal(probe.summary, 'First 100 rows');
      await clickAndWait(snapshot, 'Create JSON File');
      const created = path.join(path.dirname(big), 'big.json');
      const data = JSON.parse(fs.readFileSync(created, 'utf8'));
      assert.equal(data.length, rows.length, 'every row imported');
      assert.deepEqual(data.at(-1), {
        id: rows.length - 1,
        label: `row number ${rows.length - 1} of the large file`,
        even: (rows.length - 1) % 2 === 0,
      });
      // Above the threshold, the created file opens in spec 008's large-file mode.
      await expectOnly(vscode.Uri.file(created), 'custom', isCustom);
      const view = () =>
        hooks.webviews().find((w) => w.uri === vscode.Uri.file(created).toString());
      await waitFor('the big.json webview', () => view() !== undefined);
      assert.deepEqual(view().largeFile, { bytes: fs.statSync(created).size, unlocked: false });
      await closeAll();

      const huge = write('huge.csv', Buffer.alloc(CEILING + 1, 'a'));
      const before = hooks.csvs().length;
      await vscode.commands.executeCommand(CONVERT, vscode.Uri.file(huge));
      assert.deepEqual(hooks.csv(undefined).messages, [
        'CHR JSON Editor: huge.csv is 50.0 MiB, too large for CSV import (the limit is 50 MiB).',
      ]);
      assert.equal(hooks.csvs().length, before, 'a panel opened for a CSV file above the ceiling');
      fs.rmSync(huge);

      // A short CSV whose JSON is longer than the ceiling: one long field name over many rows.
      const field = 'a_long_field_name_for_the_ceiling_test';
      const count = 1_300_000;
      const wide = write('wide.csv', `${field}\r\n${'1\r\n'.repeat(count)}`);
      assert.ok(fs.statSync(wide).size < CEILING);
      hooks.ceiling(false);
      const panel = await panelFrom(CONVERT, vscode.Uri.file(wide));
      await clickAndWait(panel.snapshot, 'Create JSON File');
      const wideJson = path.join(path.dirname(wide), 'wide.json');
      assert.ok(fs.statSync(wideJson).size > CEILING, 'the JSON file is above the ceiling');
      let ceiling = [];
      await waitFor('the ceiling message', () => {
        ceiling = ceiling.concat(hooks.ceiling(false));
        return ceiling.length > 0;
      });
      assert.equal(ceiling.length, 1);
      assert.match(ceiling[0], /^wide\.json is \d+\.\d MiB\. VS Code does not pass files/);
      hooks.ceiling(undefined);
      await closeAll();
      fs.rmSync(path.dirname(wide), { recursive: true, force: true });
      console.log('CSV: large CSV files import in full; the ceiling holds both ways');
    }

    // Spec 015 B9 in the panel (015 T5, from the 015 T4 review): the export preview writes big
    // numbers as their digits, unquoted, and the import preview's table shows them, as "Create JSON
    // File" writes them.
    {
      const json = write('big.json', '[{"id": 12345678901234567890, "small": 1E-400, "n": 4.0}]\n');
      await openText(json);
      const exported = await panelFrom(EXPORT);
      assert.equal(lf(exported.probe.csv ?? ''), 'id,small,n\n12345678901234567890,1E-400,4\n');
      await closeAll();

      const csv = write('big.csv', 'id,name\r\n12345678901234567891,second\r\n1e400,huge\r\n');
      const imported = await panelFrom(CONVERT, vscode.Uri.file(csv));
      assert.equal(imported.probe.table, true, 'big.csv: the preview table');
      const [cells] = await hooks.domCsv(imported.snapshot.title, [
        { readAll: '.csv .table .jse-table-mode td .jse-value' },
      ]);
      assert.deepEqual(JSON.parse(cells), ['12345678901234567891', 'second', '1e400', 'huge']);
      await clickAndWait(imported.snapshot, 'Create JSON File');
      const created = fs.readFileSync(path.join(path.dirname(csv), 'big.json'), 'utf8');
      assert.match(created, /"id": 12345678901234567891,/);
      assert.match(created, /"id": 1e400,/);
      await closeAll();
      console.log('CSV: the panel previews big numbers with their digits (spec 015 B9)');
    }
  } finally {
    hooks.csv(undefined);
    hooks.ceiling(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
