// Gate for 010 T3 (spec 010 criteria 8, 9 and 10 in the text editor), run by suite.cjs inside
// VS Code. "Smart Format" runs from the command palette's id on copies of
// tests/e2e/fixtures/smart-format/*:
// - criterion 8: in the text editor and in a CHR JSON Editor tab (tree, text and table mode), the
//   document becomes expected.* byte for byte as one edit, dirty and not saved, and one undo
//   restores the input; on an already smart-formatted text nothing changes. In text mode, typing
//   the editor has not reported yet is laid out too;
// - criterion 9: a document that does not parse is unchanged and the message names its format;
// - criterion 10 (text editor): a 6 MiB document is unchanged with the size message, and a document
//   of exactly 5 MiB is laid out. Large-file tabs are 010 T4's.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const COMMAND = 'chrJsonEditor.smartFormat';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/smart-format');
const FORMATS = ['json', 'jsonc', 'json5'];
const LABELS = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };
const THRESHOLD = 5 * 1024 * 1024;
const TOO_LARGE =
  'Smart Format is off for documents above 5 MiB because it can take a long time. Use Format instead.';

const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runSmartFormat = async function runSmartFormat({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-smart-format-'));

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

  /** Writes `text` to a new folder as `name` and opens it in the text editor or, in `mode`, in
   *  the CHR JSON Editor. */
  async function open(name, text, mode) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), name);
    fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    if (mode) {
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await expectOnly(uri, 'custom', isCustom);
      const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
      await waitFor(`the webview of ${name}`, () => view()?.scriptLoaded === true);
      await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
      if (mode !== 'tree') {
        assert.equal(hooks.setMode(uri.toString(), mode), true);
        await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
      }
    } else {
      await vscode.window.showTextDocument(document);
      await expectOnly(uri, 'text', isText);
    }
    return { file, uri, document };
  }

  /** Runs the command, which resolves once its edit is applied or refused. */
  async function smartFormat() {
    await vscode.commands.executeCommand(COMMAND);
  }

  /** Criterion 8 on one opened fixture: one edit to expected, dirty, not saved, one undo back. */
  async function criterion8(label, { file, document }, input, expected) {
    assert.equal(document.getText(), input, `${label}: the input`);
    const version = document.version;
    await smartFormat();
    await waitFor(`${label}: the smart-formatted text`, () => document.getText() === expected);
    assert.equal(document.version, version + 1, `${label}: one edit`);
    assert.equal(document.isDirty, true, `${label}: dirty`);
    assert.equal(fs.readFileSync(file, 'utf8'), input, `${label}: not saved`);
    // Already smart-formatted: no edit.
    await smartFormat();
    assert.equal(document.version, version + 1, `${label}: no edit on formatted text`);
    await vscode.commands.executeCommand('undo');
    await waitFor(`${label}: the undo`, () => document.getText() === input);
    assert.equal(document.isDirty, false, `${label}: clean after one undo`);
    assert.deepEqual(hooks.smartFormatMessages(), [], `${label}: no message`);
  }

  try {
    hooks.smartFormatMessages();

    // The command is in the palette for both editors, under its title.
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const entry = manifest.contributes.commands.find((c) => c.command === COMMAND);
    assert.equal(entry?.title, 'Smart Format');
    const palette = manifest.contributes.menus.commandPalette.find((m) => m.command === COMMAND);
    assert.match(palette.when, /activeCustomEditorId == chrJsonEditor.editor/);
    assert.match(palette.when, /activeEditor == workbench.editors.files.textFileEditor/);

    // Criterion 8: the text editor, each format.
    for (const format of FORMATS) {
      const input = read(`input.${format}`);
      const opened = await open(`data.${format}`, input);
      await criterion8(`${format} (text editor)`, opened, input, read(`expected.${format}`));
      await closeAll();
    }

    // Criterion 8: a CHR JSON Editor tab, each format in tree mode, and JSON in text and table.
    for (const [format, mode] of [
      ['json', 'tree'],
      ['jsonc', 'tree'],
      ['json5', 'tree'],
      ['json', 'text'],
      ['json', 'table'],
    ]) {
      const input = read(`input.${format}`);
      const opened = await open(`data.${format}`, input, mode);
      await criterion8(
        `${format} (CHR JSON Editor, ${mode})`,
        opened,
        input,
        read(`expected.${format}`),
      );
      const probe = await hooks.probe(opened.uri.toString());
      assert.deepEqual(probe.violations, [], 'the command broke the CSP');
      await closeAll();
    }

    // Criterion 8: in text mode, typing the editor has not reported yet is laid out too.
    {
      const input = read('input.jsonc');
      const { uri, document } = await open('typed.jsonc', input, 'text');
      await hooks.type(uri.toString(), '// typed');
      await smartFormat();
      await waitFor('the typed text, smart-formatted', () =>
        document.getText().startsWith(read('expected.jsonc').trimEnd()),
      );
      assert.match(document.getText(), /\/\/ typed$/);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await closeAll();
    }

    // Criterion 9: broken source, in both editors.
    for (const mode of [undefined, 'tree']) {
      const label = mode ? 'CHR JSON Editor' : 'text editor';
      for (const format of FORMATS) {
        const input = read('broken.json');
        const { file, document } = await open(`broken.${format}`, input, mode);
        const version = document.version;
        await smartFormat();
        assert.equal(document.getText(), input, `broken ${format} (${label}): unchanged`);
        assert.equal(document.version, version, `broken ${format} (${label}): no edit`);
        assert.equal(fs.readFileSync(file, 'utf8'), input);
        assert.deepEqual(hooks.smartFormatMessages(), [
          `Smart Format needs valid ${LABELS[format]}. Fix the errors or run Repair JSON first.`,
        ]);
        await closeAll();
      }
    }

    // Criterion 10 (text editor): above 5 MiB of UTF-8, nothing changes; at exactly 5 MiB it runs.
    {
      const sized = (bytes) => `[${' '.repeat(bytes - 4)}1]\n`;
      const above = sized(6 * 1024 * 1024);
      const big = await open('big.json', above);
      await smartFormat();
      assert.equal(big.document.getText(), above, '6 MiB: unchanged');
      assert.equal(big.document.isDirty, false, '6 MiB: not dirty');
      assert.deepEqual(hooks.smartFormatMessages(), [TOO_LARGE]);
      await closeAll();

      // One byte over, counted in UTF-8: a two-byte character in a string.
      const over = `["é${' '.repeat(THRESHOLD - 6)}"]\n`;
      assert.equal(Buffer.byteLength(over), THRESHOLD + 1);
      const justOver = await open('over.json', over);
      await smartFormat();
      assert.equal(justOver.document.getText(), over, '5 MiB + 1 byte: unchanged');
      assert.deepEqual(hooks.smartFormatMessages(), [TOO_LARGE]);
      await closeAll();

      const at = sized(THRESHOLD);
      assert.equal(Buffer.byteLength(at), THRESHOLD);
      const edge = await open('edge.json', at);
      await smartFormat();
      await waitFor('5 MiB: smart-formatted', () => edge.document.getText() === '[1]\n', 30000);
      assert.deepEqual(hooks.smartFormatMessages(), []);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await closeAll();
    }
  } finally {
    await closeAll();
    fs.rmSync(work, { recursive: true, force: true });
  }
};
