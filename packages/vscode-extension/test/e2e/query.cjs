// Gate for 011 T5 (spec 011 criterion 7), run by suite.cjs inside VS Code: Transform with
// JavaScript and with Lodash, driven through the library's own dialog with the `dom` test hook, on
// each case in tests/e2e/fixtures/query/<case>/ (`input.<ext>`, `expected.<ext>`, `case.json`
// with `language`, `mode`, `query` and, for a query on a selected node, the `node` key to select
// in tree mode). After Transform the document's text is byte-equal to `expected.<ext>`, it is dirty
// and not saved, and one `undo` restores `input.<ext>` exactly. Every run also loads and compiles
// the query engine under the editor's CSP with no violation (criterion 9). Each case works on a
// copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const CASES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/query');

/** The case folders, each with its input, expected text and case.json. */
function loadCases() {
  return fs
    .readdirSync(CASES)
    .sort()
    .map((name) => {
      const dir = path.join(CASES, name);
      const files = fs.readdirSync(dir).sort();
      const input = files.find((f) => /^input\.(json|jsonc|json5)$/.test(f));
      assert.ok(input, `${name}: no input.{json,jsonc,json5}`);
      const ext = path.extname(input);
      assert.deepEqual(files, ['case.json', `expected${ext}`, input].sort(), `${name}: files`);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
      assert.ok(['JavaScript', 'Lodash'].includes(meta.language), `${name}: language`);
      assert.ok(['tree', 'text', 'table'].includes(meta.mode), `${name}: mode`);
      assert.ok(meta.node === undefined || meta.mode === 'tree', `${name}: a node needs tree mode`);
      return {
        name,
        meta,
        input: path.join(dir, input),
        expected: fs.readFileSync(path.join(dir, `expected${ext}`), 'utf8'),
      };
    });
}

/** The steps that open Transform (on the whole document, or on `node` in tree mode), pick
 *  `language`, type `query` and press Transform. */
function transformSteps({ mode, node, language, query }) {
  const open = node
    ? [
        { mousedown: '.jse-tree-mode .jse-key', text: node },
        { click: '.jse-tree-mode button.jse-contextmenu' },
        { click: '.jse-contextmenu button', text: 'Transform' },
      ]
    : [{ click: `.jse-${mode}-mode .jse-transform` }];
  return [
    ...open,
    // The first Transform waits for the engine to load and compile, then opens the dialog.
    { click: '.jse-modal .jse-config' },
    { click: '.jse-query-language', text: language },
    { fill: '.jse-modal textarea.jse-query', value: query },
    { click: '.jse-modal button.jse-primary', text: 'Transform' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runQuery = async function runQuery({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-query-'));

  async function probeUntil(uri, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const cases = loadCases();
  const covered = new Set(
    cases.map((c) => `${c.meta.language} ${c.meta.node ? 'node' : c.meta.mode}`),
  );
  for (const language of ['JavaScript', 'Lodash']) {
    for (const where of ['tree', 'text', 'table', 'node']) {
      assert.ok(covered.has(`${language} ${where}`), `no ${language} case in ${where}`);
    }
  }

  try {
    for (const { name, meta, input, expected } of cases) {
      const target = path.join(fs.mkdtempSync(path.join(work, 'case-')), path.basename(input));
      fs.copyFileSync(input, target);
      const before = fs.readFileSync(target, 'utf8');
      const uri = vscode.Uri.file(target);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await expectOnly(uri, 'custom', isCustom);
      const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
      await waitFor(`the webview of ${name}`, () => view()?.scriptLoaded === true);
      await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
      if (meta.mode !== 'tree') {
        assert.equal(hooks.setMode(uri.toString(), meta.mode), true);
        await probeUntil(uri, `${meta.mode} mode`, (p) => p.mode === meta.mode);
      }

      await hooks.dom(uri.toString(), transformSteps(meta));
      await waitFor(
        `${name}: Transform to change the document`,
        () => document.getText() !== before,
      );
      await probeUntil(uri, `${name}: the result to show`, (p) => p.notice === '' && !!p.content);
      assert.equal(document.getText(), expected, `${name}: not expected${path.extname(input)}`);
      assert.equal(document.isDirty, true, `${name}: the document is not dirty`);
      assert.equal(fs.readFileSync(target, 'utf8'), before, `${name}: the file was saved`);
      const probe = await hooks.probe(uri.toString());
      assert.deepEqual(probe.violations, [], `${name}: CSP violations`);

      await vscode.commands.executeCommand('undo');
      await waitFor(`${name}: the undo`, () => document.getText() !== expected);
      // Long enough for a second, wrong undo or a late write to land.
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(document.getText(), before, `${name}: one undo did not restore the input`);
      await waitFor(`${name}: the undo to clear the dirty marker`, () => !document.isDirty);
      await closeAll();
      console.log(
        `criterion 7: ${name}: ${meta.language} Transform ` +
          `(${meta.node ? `node "${meta.node}"` : `${meta.mode} mode`}) writes expected, one undo restores`,
      );
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
