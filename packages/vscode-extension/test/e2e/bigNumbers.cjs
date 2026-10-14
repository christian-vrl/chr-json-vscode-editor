// Gate for 015 T4 (spec 015 criteria 4 and 7), run by suite.cjs inside VS Code on
// tests/e2e/fixtures/big-numbers/input.{json,jsonc,json5}: the tree and the table show every big
// number's decimal text; a patch setting /a to the typed text 98765432109876543210 writes
// expected-edit.*; "Copy" on a big number puts its digits on the clipboard; search finds
// 12345678901234567890; sorting `ids` ascending, by the sort dialog and by the table header (in the
// nested editor the table mode offers for an array in an object), writes expected-sort.*, and
// descending by the header (clicked twice) expected-sort-desc.* (015 T5); tree →
// text → table → tree leaves the bytes unchanged. Criterion 7: an integer schema on big integers
// reports no error, and validation does not throw. Criterion 6 is compare.cjs's. Each case works on
// a copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/big-numbers');
const FORMATS = ['json', 'jsonc', 'json5'];

/** The big numbers of the fixtures, as the editor must show them (the json5 hex one shows as its
 *  decimal digits, 12345678901234567890). */
const BIG = [
  '12345678901234567890',
  '0.1000000000000000000001',
  '1e400',
  '9007199254740993',
  '1E-400',
  '-12345678901234567890',
  '12345678901234567891',
];
const IDS = ['1e400', '-12345678901234567890', '5', '12345678901234567891'];
const SEARCHED = '12345678901234567890';
/** Where SEARCHED shows: /a, two ids, a record's id, and the json5 hex member. */
const SEARCH_HITS = { json: 4, jsonc: 4, json5: 5 };
const EDIT = `[{"op": "replace", "path": "/a", "value": 98765432109876543210}]`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The library's nested-array buttons in table mode's welcome screen: title, info, then one row
 *  per array (plain, ids, records), whose first button opens it in the nested editor. */
const editArray = (row) => ({
  click: `.jse-table-mode .jse-nested-arrays > .jse-nested-property:nth-child(${row + 3}) button`,
  text: 'Edit',
});
const MODAL = 'dialog.jse-jsoneditor-modal';

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runBigNumbers = async function runBigNumbers({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-big-numbers-'));

  async function probeUntil(uri, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await sleep(100);
    }
  }

  /** Runs `steps` until the last read satisfies `predicate`, and returns that read. */
  async function readUntil(uri, steps, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let read;
    for (;;) {
      read = (await hooks.dom(uri.toString(), steps)).pop();
      if (predicate(read)) return read;
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${what}; last read: ${read}`);
      await sleep(100);
    }
  }

  /** Opens a copy of `source` in the custom editor, in `mode`, once the editor holds it. */
  async function open(source, mode = 'tree') {
    const target = path.join(fs.mkdtempSync(path.join(work, 'case-')), path.basename(source));
    fs.copyFileSync(source, target);
    const uri = vscode.Uri.file(target);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the webview of ${path.basename(source)}`, () => view()?.scriptLoaded === true);
    await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
    if (mode !== 'tree') {
      assert.equal(hooks.setMode(uri.toString(), mode), true);
      await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
    }
    return { uri, document, view };
  }

  async function finish(uri, document) {
    const probe = await hooks.probe(uri.toString());
    assert.deepEqual(probe.violations, [], 'the case broke the CSP');
    assert.equal(probe.notice, '', 'the case left a notice');
    await document.save();
    await closeAll();
  }

  /** Runs `steps` and waits for the document to read `expected`. */
  async function expectWrite(uri, document, steps, expected, what) {
    await hooks.dom(uri.toString(), steps);
    await waitFor(`${what} to write the expected text`, () => document.getText() === expected);
    await probeUntil(uri, `${what} to show`, (p) => p.notice === '' && !!p.content);
    await sleep(300);
    assert.equal(document.getText(), expected, `${what}: wrote more than once`);
  }

  try {
    for (const format of FORMATS) {
      const name = `input.${format}`;
      const source = path.join(FIXTURES, name);
      const bytes = fs.readFileSync(source, 'utf8');
      const expectedEdit = fs.readFileSync(path.join(FIXTURES, `expected-edit.${format}`), 'utf8');
      const expectedSort = fs.readFileSync(path.join(FIXTURES, `expected-sort.${format}`), 'utf8');

      // The tree shows each big number's digits; search finds one; copy puts its digits on the
      // clipboard; tree → text → table → tree writes nothing.
      {
        const { uri, document, view } = await open(source);
        const [shown] = await hooks.dom(uri.toString(), [{ readAll: '.jse-tree-mode .jse-value' }]);
        const values = JSON.parse(shown);
        for (const big of BIG) assert.ok(values.includes(big), `${name}: the tree shows no ${big}`);

        const count = await readUntil(
          uri,
          [
            { key: 'f', ctrl: true, on: '.jse-tree-mode .jse-hidden-input' },
            { fill: '.jse-search-input', value: SEARCHED },
            { read: '.jse-search-count' },
          ],
          `${name}: the search count`,
          (text) => text?.trim() === `1/${SEARCH_HITS[format]}`,
        );
        assert.equal(count.trim(), `1/${SEARCH_HITS[format]}`);
        await hooks.dom(uri.toString(), [{ click: '.jse-search-clear' }]);

        await vscode.env.clipboard.writeText('');
        await hooks.dom(uri.toString(), [
          { mousedown: `.jse-tree-mode [data-path="${encodeURIComponent('/a')}"] .jse-value` },
          { key: 'c', ctrl: true, on: '.jse-tree-mode .jse-hidden-input' },
        ]);
        const deadline = Date.now() + 5000;
        let copied = '';
        while (copied !== SEARCHED && Date.now() < deadline) {
          await sleep(100);
          copied = await vscode.env.clipboard.readText();
        }
        assert.equal(copied, SEARCHED, `${name}: Copy put another text on the clipboard`);

        for (const mode of ['text', 'table', 'tree']) {
          assert.equal(hooks.setMode(uri.toString(), mode), true);
          await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
        }
        await sleep(500);
        assert.equal(document.getText(), bytes, `${name}: switching modes changed the document`);
        assert.equal(document.isDirty, false, `${name}: switching modes made it dirty`);
        assert.equal(view().editsReceived, 0, `${name}: switching modes sent an edit`);
        await finish(uri, document);
        console.log(
          `criterion 4: ${name} shows, finds and copies big numbers; modes write nothing`,
        );
      }

      // A patch whose value is typed text with more digits than a float holds.
      {
        const { uri, document } = await open(source);
        assert.equal(hooks.patch(uri.toString(), EDIT), true);
        await waitFor(`${name}: the edit`, () => document.getText() !== bytes).catch(() => {});
        await sleep(300);
        assert.equal(document.getText(), expectedEdit, `${name}: the edit`);
        await finish(uri, document);
        console.log(`criterion 4: ${name} edit writes expected-edit.${format} byte for byte`);
      }

      // Sorting `ids` ascending with the sort dialog.
      {
        const { uri, document } = await open(source);
        await expectWrite(
          uri,
          document,
          [
            { mousedown: '.jse-tree-mode .jse-key', text: 'ids' },
            { click: '.jse-tree-mode button.jse-contextmenu' },
            { click: '.jse-contextmenu button', text: 'Sort' },
            { click: '.jse-modal button.jse-primary', text: 'Sort' },
            { waitFor: '.jse-modal', gone: true },
          ],
          expectedSort,
          `${name}: the sort dialog`,
        );
        await finish(uri, document);
        console.log(`criterion 4: ${name} sort dialog writes expected-sort.${format}`);
      }

      // The table shows the big numbers (the records' ids and `ids`, each in the nested editor),
      // and sorting `ids` by its header, then Apply, writes the same.
      {
        const { uri, document } = await open(source, 'table');
        const [recordCells] = await hooks.dom(uri.toString(), [
          editArray(2),
          { readAll: `${MODAL} .jse-table-mode td .jse-value` },
          { click: `${MODAL} .jse-close` },
          { waitFor: MODAL, gone: true },
        ]);
        for (const id of ['12345678901234567891', '9007199254740993', '12345678901234567890']) {
          assert.ok(
            JSON.parse(recordCells).includes(id),
            `${name}: the records table has no ${id}`,
          );
        }
        const [idCells] = await hooks.dom(uri.toString(), [
          editArray(1),
          { readAll: `${MODAL} .jse-table-mode td .jse-value` },
        ]);
        for (const id of IDS) {
          assert.ok(JSON.parse(idCells).includes(id), `${name}: the ids table has no ${id}`);
        }
        assert.equal(document.getText(), bytes, `${name}: opening the nested editor wrote`);
        await expectWrite(
          uri,
          document,
          [
            { click: `${MODAL} .jse-column-header` },
            { waitFor: `${MODAL} .jse-column-sort-icon` },
            { click: `${MODAL} button.jse-primary`, text: 'Apply' },
            { waitFor: MODAL, gone: true },
          ],
          expectedSort,
          `${name}: the table header sort`,
        );
        await finish(uri, document);
        console.log(`criterion 4: ${name} table shows big numbers; header sort = expected-sort`);
      }

      // The header clicked twice sorts `ids` descending: Apply writes expected-sort-desc.* (015 T5,
      // from the 015 T4 review: the header sort was covered ascending only).
      {
        const { uri, document } = await open(source, 'table');
        const expectedDesc = fs.readFileSync(
          path.join(FIXTURES, `expected-sort-desc.${format}`),
          'utf8',
        );
        await hooks.dom(uri.toString(), [
          editArray(1),
          { click: `${MODAL} .jse-column-header` },
          { waitFor: `${MODAL} .jse-column-sort-icon[title*="ascending"]` },
        ]);
        await expectWrite(
          uri,
          document,
          [
            { click: `${MODAL} .jse-column-header` },
            { waitFor: `${MODAL} .jse-column-sort-icon[title*="descending"]` },
            { click: `${MODAL} button.jse-primary`, text: 'Apply' },
            { waitFor: MODAL, gone: true },
          ],
          expectedDesc,
          `${name}: the table header sort, descending`,
        );
        await finish(uri, document);
        console.log(`criterion 4: ${name} header sort descending = expected-sort-desc`);
      }
    }

    // Criterion 7: an integer schema on big integers reports no error, and nothing throws.
    {
      const { uri, document, view } = await open(path.join(FIXTURES, 'input.json'));
      const schema = {
        type: 'object',
        properties: {
          a: { type: 'integer' },
          e: { type: 'integer' },
          ids: { type: 'array', items: { type: 'number' } },
          records: { type: 'array', items: { properties: { id: { type: 'integer' } } } },
        },
      };
      assert.equal(hooks.setSchema(uri.toString(), schema), true);
      await waitFor('validation of input.json', () => view().validationsShown.length > 0);
      const shown = view().validationsShown.at(-1);
      assert.equal(shown.docVersion, document.version);
      assert.deepEqual(shown.errors, [], 'an integer schema reported an error on a big integer');
      const probe = await hooks.probe(uri.toString());
      assert.deepEqual(probe.validationMarks, []);
      await finish(uri, document);
      console.log('criterion 7: an integer schema on big integers reports no error');
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
