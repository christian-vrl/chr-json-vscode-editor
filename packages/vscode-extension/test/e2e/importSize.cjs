// Gate for 017 T4 (spec 017 criteria 8 and 9), run by suite.cjs inside VS Code. The fixtures are
// generated in run.mjs's scratch folder:
// - Criterion 8: a 6 MiB XML file converts in full under the progress notification and its JSON
//   (above the 5 MiB threshold) opens locked in spec 008's large-file mode; a 5.5 MiB TOML file of
//   nested arrays converts under the notification into a JSON file above VS Code's 50 MB sync limit,
//   which is written, and opening it shows spec 008 criterion 9's message; a TOML file one byte
//   above the ceiling and a YAML file one byte above the YAML limit (UNK-077) are not read: the
//   message names the size and the limit, and nothing is written, by either command.
// - Criterion 9: in a tab locked in large-file mode (spec 008's 6 MiB JSON fixture) the
//   `chrJsonEditor.customEditorLocked` key hides "Import YAML, TOML or XML…" (its menu entries are
//   checked in import.cjs) and, run anyway, it says why without asking for a file; the convert
//   commands work as before; after "Edit anyway" the key is cleared and the import asks again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const MIB = 1024 * 1024;
/** Spec 008's threshold (UNK-014) and VS Code's sync limit, the ceiling (008 criterion 9). */
const THRESHOLD = 5 * MIB;
const CEILING = 50 * MIB;
/** UNK-077's YAML limit, as packages/vscode-extension/src/importPlan.ts sets it. */
const YAML_LIMIT = 10 * MIB;
const CONVERT = {
  yaml: 'chrJsonEditor.convertYamlToJson',
  toml: 'chrJsonEditor.convertTomlToJson',
  xml: 'chrJsonEditor.convertXmlToJson',
};
const IMPORT = 'chrJsonEditor.importFile';
const LOCKED_IMPORT_MESSAGE =
  'CHR JSON Editor: this large file is read-only. Choose "Edit anyway" to import into it.';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/import');
const REPLACE = path.resolve(__dirname, '../../../../tests/import/replace');

/** `<root>` holding `<i>x</i>` lines up to exactly `bytes` bytes, padded with spaces. */
function xmlText(bytes) {
  const open = '<root>\n';
  const close = '</root>\n';
  const line = '<i>x</i>\n';
  const count = Math.floor((bytes - open.length - close.length) / line.length);
  const body = open + line.repeat(count);
  return { text: body + ' '.repeat(bytes - body.length - close.length) + close, count };
}

/** `a = ` eight nested arrays around `1`s, exactly `bytes` bytes with a padding comment: every
 *  `1` takes 2 bytes here and a line of 21 in the JSON written (its 2-space indent 18 deep). */
function tomlText(bytes) {
  const DEPTH = 8;
  const head = `a = ${'['.repeat(DEPTH)}1`;
  const tail = `${']'.repeat(DEPTH)}\n# `;
  const count = Math.floor((bytes - head.length - tail.length - 1) / 2);
  const body = head + ',1'.repeat(count) + tail;
  return { text: body + '.'.repeat(bytes - body.length - 1) + '\n', count: count + 1 };
}

/** Spec 008's large-file fixture (largeFile.cjs): a JSON array of exactly `bytes` bytes. */
function lockedJson(bytes) {
  const head = '[\n  {"id": 0, "marker": "start"},\n';
  const line = '  {"id": 1, "name": "alpha", "tags": ["a", "b"]},\n';
  const tail = '  {"id": 2}\n]\n';
  const lines = Math.floor((bytes - head.length - tail.length) / line.length);
  const body = head + line.repeat(lines);
  return body + ' '.repeat(bytes - body.length - tail.length) + tail;
}

const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

exports.runImportSize = async function runImportSize({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const work = fs.mkdtempSync(path.join(scratch, 'import-size-'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());
  const folder = () => fs.mkdtempSync(path.join(work, 'case-'));
  const files = (file) => fs.readdirSync(path.dirname(file)).sort();

  /** Writes `text` as `name` in a new folder. */
  function write(name, text) {
    const file = path.join(folder(), name);
    fs.writeFileSync(file, text);
    assert.equal(fs.statSync(file).size, Buffer.byteLength(text));
    return file;
  }

  try {
    hooks.imports({ saveAs: () => undefined, showWarnings: false });

    // Criterion 8: above the threshold, the progress notification; the JSON (7.3 MiB) opens locked.
    {
      const { text, count } = xmlText(6 * MIB);
      const source = write('big.xml', text);
      const target = path.join(path.dirname(source), 'big.json');
      await vscode.commands.executeCommand(CONVERT.xml, vscode.Uri.file(source));
      assert.deepEqual(hooks.imports(undefined).messages, ['Converting big.xml…']);
      const written = fs.readFileSync(target, 'utf8');
      const data = JSON.parse(written);
      assert.equal(data.root.i.length, count, 'not every element was converted');
      const bytes = Buffer.byteLength(written);
      assert.ok(bytes > THRESHOLD, `big.json is ${bytes} bytes`);
      const uri = vscode.Uri.file(target);
      await expectOnly(uri, 'custom', isCustom);
      await waitFor('the big.json webview', () => view(uri)?.scriptLoaded, 60000);
      assert.deepEqual(view(uri).largeFile, { bytes, unlocked: false });
      assert.equal(fs.readFileSync(source, 'utf8'), text, 'the source changed');
      await closeAll();
      console.log(`import: 6 MiB XML under progress; its ${bytes}-byte JSON opens locked`);
    }

    // Criterion 8: a JSON file above the ceiling is still written; opening it shows the message.
    {
      const { text, count } = tomlText(5.5 * MIB);
      const source = write('deep.toml', text);
      const target = path.join(path.dirname(source), 'deep.json');
      hooks.ceiling(false);
      await vscode.commands.executeCommand(CONVERT.toml, vscode.Uri.file(source));
      assert.deepEqual(hooks.imports(undefined).messages, ['Converting deep.toml…']);
      const bytes = fs.statSync(target).size;
      assert.ok(bytes > CEILING, `deep.json is ${bytes} bytes`);
      const mib = (Math.floor((bytes * 10) / MIB) / 10).toFixed(1);
      assert.deepEqual(hooks.ceiling(undefined), [
        `deep.json is ${mib} MiB. VS Code does not pass files above 50 MB to extensions, so ` +
          `CHR JSON Editor can't open it.`,
      ]);
      // Every `1` was written: the innermost array's lines.
      const written = fs.readFileSync(target, 'utf8');
      assert.equal(written.split(`\n${' '.repeat(18)}1`).length - 1, count);
      assert.ok(
        !vscode.window.tabGroups.all.some((g) =>
          g.tabs.some((t) => t.input?.uri?.fsPath === target),
        ),
        'deep.json opened',
      );
      await closeAll();
      console.log(`import: 5.5 MiB TOML under progress; its ${bytes}-byte JSON is written`);
    }

    // Criterion 8: above the ceiling, or a YAML file above the YAML limit, the file is not read.
    const tooLarge = [
      [
        'over.toml',
        `a = 1\n#${'.'.repeat(CEILING + 1 - 8)}\n`,
        'CHR JSON Editor: over.toml is too large to convert (50.1 MiB; the limit for TOML is 50.0 MiB).',
      ],
      [
        'over.yaml',
        `a: 1\n#${'.'.repeat(YAML_LIMIT + 1 - 7)}\n`,
        'CHR JSON Editor: over.yaml is too large to convert (10.1 MiB; the limit for YAML is 10.0 MiB).',
      ],
    ];
    for (const [name, text, message] of tooLarge) {
      const source = write(name, text);
      assert.equal(fs.statSync(source).size, name.endsWith('.toml') ? CEILING + 1 : YAML_LIMIT + 1);
      const kind = path.extname(name).slice(1);
      await vscode.commands.executeCommand(CONVERT[kind], vscode.Uri.file(source));
      assert.deepEqual(hooks.imports(undefined).messages, [message], `${name}: convert`);
      assert.deepEqual(files(source), [name], `${name}: a file was written`);

      // "Import YAML, TOML or XML…" reads with the same limits, and asks nothing.
      const target = path.join(folder(), 'doc.json');
      fs.copyFileSync(path.join(REPLACE, 'json-toml', 'before.json'), target);
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), VIEW_TYPE);
      await waitFor('the doc.json tab', () => isCustom(activeTab()));
      hooks.imports({ pick: () => vscode.Uri.file(source).toString() });
      hooks.confirm(() => {
        throw new Error(`asked about ${name}`);
      });
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      hooks.confirm(undefined);
      assert.deepEqual(hooks.imports(undefined).messages, [message], `${name}: import`);
      await closeAll();
      console.log(`import: ${name} above its limit is not read`);
    }

    // Criterion 9 on spec 008's fixture: a 6 MiB JSON file opens locked.
    {
      const file = write('big.json', lockedJson(6 * MIB));
      const uri = vscode.Uri.file(file);
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor('the big.json webview', () => view(uri)?.scriptLoaded, 60000);
      assert.deepEqual(view(uri).largeFile, { bytes: 6 * MIB, unlocked: false });
      await waitFor('the locked context key', () => hooks.csvLocked() === true);

      // Run anyway: the message, and no open dialog.
      hooks.imports({
        pick: () => {
          throw new Error('asked for a file in a locked tab');
        },
      });
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      assert.deepEqual(hooks.imports(undefined).messages, [LOCKED_IMPORT_MESSAGE]);
      assert.equal(fs.statSync(file).size, 6 * MIB);

      // The convert commands are not affected.
      const yaml = path.join(folder(), 'config.yaml');
      fs.copyFileSync(path.join(FIXTURES, 'yaml', 'config.yaml'), yaml);
      await vscode.commands.executeCommand(CONVERT.yaml, vscode.Uri.file(yaml));
      assert.equal(
        fs.readFileSync(path.join(path.dirname(yaml), 'config.json'), 'utf8'),
        fs.readFileSync(path.join(FIXTURES, 'yaml', 'expected.json'), 'utf8'),
      );
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // "Edit anyway": the key is cleared and the import asks for a file and before replacing.
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor('the big.json tab', () => isCustom(activeTab()));
      await hooks.dom(uri.toString(), [{ click: '.banner button', text: 'Edit anyway' }]);
      await waitFor('the unlock', () => view(uri).largeFile.unlocked);
      await waitFor('the context key after the unlock', () => hooks.csvLocked() === false);
      const toml = path.join(folder(), 'data.toml');
      fs.writeFileSync(toml, 'a = 1\n');
      hooks.imports({ pick: () => vscode.Uri.file(toml).toString() });
      hooks.confirm(false);
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      assert.deepEqual(hooks.confirm(undefined), [
        'Replace the data of big.json with the data of data.toml? Comments on members that stay ' +
          'are kept.',
      ]);
      assert.deepEqual(hooks.imports(undefined).messages, []);
      await closeAll();
      console.log('import: a locked tab offers no import until "Edit anyway"; convert stays');
    }
  } finally {
    hooks.imports(undefined);
    hooks.confirm(undefined);
    hooks.ceiling(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
