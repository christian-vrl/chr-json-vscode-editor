// Gate for 015 T6 (spec 015 criterion 12, UNK-068 ★), run by suite.cjs inside VS Code: in a tab
// locked in large-file mode (above 5 MiB), the tree and the table show every big number's digits,
// and the file's bytes never change: no edit is sent, the document stays clean, and switching modes
// writes nothing. One fixture per format (JSON, JSONC, JSON5, JSON Lines), generated in the
// profile's scratch folder (run.mjs deletes it): 6 MiB whose first item holds big numbers and whose
// other items each hold the big id 9007199254740993.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const SIX_MIB = 6 * 1024 * 1024;
/** Long enough for a wrong edit to have landed: one message round trip and more. */
const SETTLE_MS = 500;

/** The first item's big numbers, as the editor must show them. */
const BIG = ['12345678901234567890', '0.1000000000000000000001', '1e400', '9007199254740993'];

/** How each format writes the first item, every other item and the end. */
const SHAPES = {
  json: {
    head: '[\n  {"id": 12345678901234567890, "b": 0.1000000000000000000001, "c": 1e400},\n',
    line: '  {"id": 9007199254740993, "name": "alpha"},\n',
    tail: '  {"id": 2}\n]\n',
  },
  jsonc: {
    head: '// A large JSONC file\n[\n  {"id": 12345678901234567890, "b": 0.1000000000000000000001, "c": 1e400}, // first\n',
    line: '  {"id": 9007199254740993, "name": "alpha"}, /* item */\n',
    tail: '  {"id": 2},\n]\n',
  },
  json5: {
    head: '// A large JSON5 file\n[\n  {id: 0xAB54A98CEB1F0AD2, b: 0.1000000000000000000001, c: 1e400},\n',
    line: "  {id: 9007199254740993, name: 'alpha'},\n",
    tail: '  {id: 2,},\n]\n',
  },
  jsonl: {
    head: '{"id": 12345678901234567890, "b": 0.1000000000000000000001, "c": 1e400}\n',
    line: '{"id": 9007199254740993, "name": "alpha"}\n',
    tail: '{"id": 2}\n',
  },
};

/** An ASCII document of `bytes` bytes in `format`, padded with spaces before its tail. */
function documentText(format, bytes) {
  const { head, line, tail } = SHAPES[format];
  const count = Math.floor((bytes - head.length - tail.length) / line.length);
  const body = head + line.repeat(count);
  const text = body + ' '.repeat(bytes - body.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(text), bytes);
  return text;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.runBigNumbersLargeFile = async function runBigNumbersLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'big-numbers-large-file-'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

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

  /** The values the page shows for `selector`, once one of them is `wanted`. */
  async function shownValues(uri, selector, wanted, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [read] = await hooks.dom(uri.toString(), [{ readAll: selector }]);
      const values = JSON.parse(read ?? '[]');
      if (values.includes(wanted)) return values;
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${wanted} in ${selector}; read ${read}`);
      await sleep(200);
    }
  }

  /** Expands the tree node at `pointer` unless it is expanded. */
  async function expand(uri, pointer) {
    const node = `.jse-tree-mode .jse-json-node[data-path="${encodeURIComponent(pointer)}"]`;
    const [expanded] = await hooks.dom(uri.toString(), [{ read: node, attr: 'class' }]);
    if (/\bjse-expanded\b/.test(expanded ?? '')) return;
    await hooks.dom(uri.toString(), [
      { click: `${node} .jse-expand` },
      { waitFor: `${node}.jse-expanded` },
    ]);
  }

  for (const format of Object.keys(SHAPES)) {
    const name = `big-numbers-6mib.${format}`;
    const file = path.join(dir, name);
    const text = documentText(format, SIX_MIB);
    fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${name} webview`, () => view(uri)?.scriptLoaded, 60000);
    const opened = await probeUntil(uri, 'the document in the editor', (p) => !!p.content);
    assert.deepEqual(view(uri).largeFile, { bytes: SIX_MIB, unlocked: false }, `${name}: locked`);

    // Both modes a large file offers show the first item's digits (JSON Lines opens in Table).
    const modes = opened.mode === 'table' ? ['table', 'tree'] : ['tree', 'table'];
    for (const mode of modes) {
      if ((await hooks.probe(uri.toString())).mode !== mode) {
        assert.equal(hooks.setMode(uri.toString(), mode), true);
        await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
      }
      const selector =
        mode === 'tree' ? '.jse-tree-mode .jse-value' : '.jse-table-mode td .jse-value';
      // The tree may show the root or its first items collapsed: expand them.
      if (mode === 'tree') for (const pointer of ['', '/0', '/1']) await expand(uri, pointer);
      const values = await shownValues(uri, selector, BIG[0]);
      for (const big of BIG) assert.ok(values.includes(big), `${name} (${mode}): shows no ${big}`);
      console.log(`criterion 12: ${name} in ${mode} mode shows the digits`);
    }

    // Read-only: a patch sends nothing, and the bytes never change.
    assert.equal(hooks.patch(uri.toString(), [{ op: 'replace', path: '/0/id', value: 1 }]), true);
    await sleep(SETTLE_MS);
    assert.equal(view(uri).editsReceived, 0, `${name}: a locked tab sent an edit`);
    assert.equal(document.getText(), text, `${name}: the bytes changed`);
    assert.equal(document.isDirty, false, `${name}: the tab is dirty`);
    assert.equal(fs.readFileSync(file, 'utf8'), text);
    await closeAll();
  }
  console.log('criterion 12: locked large-file tabs show big numbers exactly and write nothing');
};
