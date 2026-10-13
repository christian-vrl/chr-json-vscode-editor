// Web e2e (013 T4, spec 013 criterion 7): "Export to CSV…", "Import CSV…" and "Convert CSV to JSON"
// on the virtual scheme, as test/e2e/csv.cjs checks them on desktop (spec 009 criteria 4, 5 and 9's
// CSP): the CSV panel opens, its buttons save, copy, create a JSON file opened in the CHR JSON
// Editor, or replace the document's data as one undoable edit. Large CSV files are spec 013 T5's
// (large files in the web host). Each case works on copies under work/.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  activeTab,
  closeAll,
  copyToCase,
  deepEqual,
  dirname,
  equal,
  expectOnly,
  fixture,
  isText,
  list,
  match,
  ok,
  openCustom,
  openText,
  readText,
  waitFor,
} from './util';
import type { TestHooks } from '../../../src/extension';

const EXPORT = 'chrJsonEditor.exportCsv';
const IMPORT = 'chrJsonEditor.importCsv';
const CONVERT = 'chrJsonEditor.convertCsvToJson';

/** jsonToCsv of tests/csv/export/people.json with the defaults, and with `;` (csv.cjs). */
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
/** csvToJson of tests/csv/import/people.csv, as "Create JSON File" writes it. */
const PEOPLE_JSON = `${JSON.stringify(
  [
    { name: 'Ada', address: { city: 'London', zip: 'NW1' }, tags: ['math', 'poetry'] },
    { name: 'Grace', address: { city: 'New York', zip: null }, tags: ['navy', null] },
  ],
  null,
  2,
)}\n`;

const lf = (text: string) => text.replace(/\r\n/g, '\n');

function isCsvPanel(tab: vscode.Tab | undefined): boolean {
  return (
    tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('chrJsonEditor.csv')
  );
}

function helpers(hooks: TestHooks) {
  /** Runs `command` and waits for the panel it opens to load its page and source. */
  async function panelFrom(command: string, ...args: unknown[]) {
    const before = hooks.csvs().length;
    const panel = await vscode.commands.executeCommand(command, ...args);
    ok(panel, `${command} opened no panel: ${JSON.stringify(hooks.csv(undefined))}`);
    await waitFor(`${command}'s panel`, () => hooks.csvs().length > before);
    const snapshot = hooks.csvs().at(-1)!;
    await waitFor(`${snapshot.title}: the page to load`, () => snapshot.scriptLoaded);
    await waitFor(`${snapshot.title}: the panel tab`, () => isCsvPanel(activeTab()));
    const probe = await waitFor(`${snapshot.title}: the page's source`, async () => {
      const shown = await hooks.probeCsv(snapshot.title);
      return shown.heading !== '' && shown.buttons.length > 0 ? shown : undefined;
    });
    return { snapshot, probe };
  }

  const click = (title: string, label: string) =>
    hooks.domCsv(title, [{ click: '.csv .actions button:not([disabled])', text: label }]);

  /** Clicks `label` and waits for the write it makes. */
  async function clickAndWait(snapshot: { title: string; writes: string[] }, label: string) {
    const before = snapshot.writes.length;
    await click(snapshot.title, label);
    await waitFor(`${snapshot.title}: ${label}`, () => snapshot.writes.length > before);
  }

  return { panelFrom, click, clickAndWait };
}

describe('CSV commands on the virtual scheme (spec 013 criterion 7)', () => {
  it('Export to CSV… saves and copies the CSV', async () => {
    const hooks = await activateHooks();
    const { panelFrom, clickAndWait } = helpers(hooks);
    try {
      const file = await copyToCase('csv', fixture('csv', 'export', 'people.json'));
      const source = await readText(file);
      const document = await openText(file);
      const { snapshot, probe } = await panelFrom(EXPORT);
      const { title } = snapshot;
      equal(title, 'Export people.json to CSV', 'title');
      deepEqual(probe.violations, [], 'CSP violations');
      deepEqual(
        probe.buttons,
        [
          { label: 'Save CSV…', disabled: false },
          { label: 'Copy CSV', disabled: false },
        ],
        'buttons',
      );
      equal(lf(probe.csv ?? ''), lf(PEOPLE_CSV), 'CSV shown');
      equal(probe.summary, '3 rows, 5 columns', 'summary');

      await clickAndWait(snapshot, 'Save CSV…');
      const saved = vscode.Uri.joinPath(dirname(file), 'people.csv');
      deepEqual(snapshot.writes, [`save ${saved.toString()}`], 'writes');
      equal(await readText(saved), PEOPLE_CSV, 'people.csv');

      // The file exists now: the save dialog picks where, prefilled with it.
      const other = vscode.Uri.joinPath(dirname(file), 'other.csv');
      hooks.csv({ saveAs: () => other.toString() });
      await hooks.domCsv(title, [{ select: '.csv .options select', value: ';' }]);
      await clickAndWait(snapshot, 'Save CSV…');
      deepEqual(hooks.csv(undefined).saveAs, [saved.toString()], 'prefilled');
      equal(await readText(other), PEOPLE_CSV_SEMICOLON, 'other.csv');

      await vscode.env.clipboard.writeText('');
      await clickAndWait(snapshot, 'Copy CSV');
      equal(await vscode.env.clipboard.readText(), PEOPLE_CSV_SEMICOLON, 'clipboard');

      deepEqual(await list(dirname(file)), ['other.csv', 'people.csv', 'people.json'], 'files');
      await closeAll();
      equal(await readText(file), source, 'the source file changed');
      equal(document.isDirty, false, 'the source document changed');
      deepEqual(
        snapshot.messages,
        ['CHR JSON Editor: saved people.csv.', 'CHR JSON Editor: saved other.csv.'],
        'messages',
      );
    } finally {
      hooks.csv(undefined);
    }
  });

  it("Import CSV… replaces the document's data as one undoable edit", async () => {
    const hooks = await activateHooks();
    const { panelFrom, clickAndWait } = helpers(hooks);
    try {
      const cases = await list(fixture('csv', 'replace'));
      ok(cases.length > 0, 'no tests/csv/replace cases');
      for (const name of cases) {
        const dir = fixture('csv', 'replace', name);
        const files = await list(dir);
        const beforeName = files.find((f) => f.startsWith('before.'))!;
        const extension = beforeName.slice(beforeName.indexOf('.'));
        const target = await copyToCase(
          'csv-replace',
          vscode.Uri.joinPath(dir, beforeName),
          `doc${extension}`,
        );
        const csv = vscode.Uri.joinPath(dirname(target), 'data.csv');
        await vscode.workspace.fs.copy(vscode.Uri.joinPath(dir, 'data.csv'), csv);
        const expected = await readText(vscode.Uri.joinPath(dir, `expected-after${extension}`));
        const original = await readText(target);
        const document = await openCustom(hooks, target);
        hooks.csv({ pick: () => csv.toString() });
        const { snapshot, probe } = await panelFrom(IMPORT);
        hooks.csv(undefined);
        equal(snapshot.title, 'Import data.csv', `${name}: title`);
        equal(probe.table, true, `${name}: the preview table`);
        await clickAndWait(snapshot, 'Replace Document Data');
        deepEqual(snapshot.writes, [`replaceData ${target.toString()}`], `${name}: writes`);
        equal(document.getText(), expected, `${name}: text after the replace`);
        equal(document.isDirty, true, `${name}: dirty`);
        equal(await readText(target), original, `${name}: saved to disk`);
        await vscode.window.showTextDocument(document);
        await waitFor(`${name}: the text editor`, () => isText(activeTab()));
        await vscode.commands.executeCommand('undo');
        await waitFor(`${name}: one undo`, () => document.getText() === original);
        equal(document.isDirty, false, `${name}: dirty after the undo`);
        await closeAll();
      }
    } finally {
      hooks.csv(undefined);
    }
  });

  it('Convert CSV to JSON creates a JSON file opened in the CHR JSON Editor', async () => {
    const hooks = await activateHooks();
    const { panelFrom, click, clickAndWait } = helpers(hooks);
    try {
      const csv = await copyToCase('csv-convert', fixture('csv', 'import', 'people.csv'));
      const csvText = await readText(csv);
      const { snapshot, probe } = await panelFrom(CONVERT, csv);
      equal(snapshot.title, 'Import people.csv', 'title');
      deepEqual(probe.buttons, [{ label: 'Create JSON File', disabled: false }], 'buttons');
      await clickAndWait(snapshot, 'Create JSON File');
      const created = vscode.Uri.joinPath(dirname(csv), 'people.json');
      equal(await readText(created), PEOPLE_JSON, 'people.json');
      await expectOnly(created, 'custom');
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await waitFor('the CSV panel again', () => isCsvPanel(activeTab()));
      hooks.csv({ saveAs: () => undefined });
      await click(snapshot.title, 'Create JSON File');
      await waitFor('the save dialog', () => hooks.csvSeen().saveAs.length === 1);
      hooks.csv(undefined);
      deepEqual(await list(dirname(csv)), ['people.csv', 'people.json'], 'files');
      equal(await readText(csv), csvText, 'the CSV file changed');
      await closeAll();

      // From the editor title of a .csv file in the text editor, and an error preview.
      const broken = await copyToCase('csv-convert', fixture('csv', 'import', 'open-quote.csv'));
      await openText(broken);
      const shown = await panelFrom(CONVERT);
      equal(shown.snapshot.title, 'Import open-quote.csv', 'title');
      match(shown.probe.error, /^Line 3: /, 'error');
      deepEqual(shown.probe.buttons, [{ label: 'Create JSON File', disabled: true }], 'buttons');
      await closeAll();
    } finally {
      hooks.csv(undefined);
    }
  });
});
