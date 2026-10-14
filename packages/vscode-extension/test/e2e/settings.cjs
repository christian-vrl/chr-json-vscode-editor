// Gate for 019 T1 (spec 019 criteria 3, 8 and 11), run by suite.cjs inside VS Code. The settings
// are written as user settings (ConfigurationTarget.Global; `[json]` values with
// overrideInLanguage): the desktop e2e opens no workspace folder, so there is no workspace level to
// write to. The reader takes every level the same way (unit test, criterion 2), and the web e2e
// reads a workspace's settings (criterion 10, 019 T6).
// - Criterion 3 (M1): `"table"` with `[json]` `"text"`: .json opens in Text, .jsonc in Table, a 6 MiB
//   .json in Tree (large-file), .jsonl in Table; a change leaves open tabs in their mode, and the
//   next tab uses it.
// - Criterion 8 (V1): off, a document that fails its schema shows no marks, no dialect notice and,
//   at 12 MiB, no paused item; on with the tab open shows the errors; off again clears them.
// - Criterion 11 (C1): "Open Settings" leaves the Settings editor active, searching for the
//   extension.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const OPEN_SETTINGS_COMMAND = 'chrJsonEditor.openSettings';
const SETTINGS_QUERY = '@ext:christian-vrl.chr-json-editor';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures');
const SIX_MIB = 6 * 1024 * 1024;
const TWELVE_MIB = 12 * 1024 * 1024;
/** Long enough for a validation or a mode change that should not happen to have shown. */
const SETTLE_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.runSettings = async function runSettings({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'settings-'));
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return vscode.Uri.file(file);
  };
  const copy = (from, name) => write(name, fs.readFileSync(path.join(FIXTURES, from), 'utf8'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  /** Writes `chrJsonEditor.<key>` to the user settings (for `languageId`'s block when given) and
   *  waits until the extension host reads it back. */
  async function set(key, value, languageId) {
    const config = vscode.workspace.getConfiguration(
      'chrJsonEditor',
      languageId ? { languageId } : undefined,
    );
    await config.update(
      key,
      value,
      vscode.ConfigurationTarget.Global,
      languageId ? true : undefined,
    );
    await waitFor(`chrJsonEditor.${key} = ${JSON.stringify(value)}`, () => {
      const inspected = vscode.workspace
        .getConfiguration('chrJsonEditor', languageId ? { languageId } : undefined)
        .inspect(key);
      return (languageId ? inspected.globalLanguageValue : inspected.globalValue) === value;
    });
  }

  async function open(uri) {
    await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${path.basename(uri.fsPath)} webview`, () => view(uri)?.scriptLoaded, 60000);
  }

  /** Waits until the editor of `uri` renders `mode`, and returns the probe. */
  async function rendered(uri, mode) {
    const deadline = Date.now() + 30000;
    for (;;) {
      const probe = await hooks.probe(uri.toString());
      if (probe.mode === mode && probe.content) return probe;
      if (Date.now() > deadline) {
        throw new Error(`${path.basename(uri.fsPath)}: ${mode} mode not rendered (${probe.mode})`);
      }
      await sleep(100);
    }
  }

  // --- Criterion 3: the default mode.
  await closeAll();
  const json = copy('open/sample.json', 'mode.json');
  const jsonc = copy('open/sample.jsonc', 'mode.jsonc');
  const later = copy('open/sample.json', 'later.json');
  const large = write('large.json', documentText('json', SIX_MIB));
  const lines = write('rows.jsonl', '{"id": 1, "name": "a"}\n{"id": 2, "name": "b"}\n');
  await set('defaultMode', 'table');
  await set('defaultMode', 'text', 'json');
  try {
    await open(json);
    await rendered(json, 'text');
    await open(jsonc);
    await rendered(jsonc, 'table');
    await open(large);
    assert.deepEqual(view(large).largeFile, { bytes: SIX_MIB, unlocked: false });
    await rendered(large, 'tree');
    await open(lines);
    await rendered(lines, 'table');
    console.log(
      'criterion 3: [json] "text" opens .json in Text, "table" opens .jsonc in Table; a large .json opens in Tree, .jsonl in Table',
    );

    // A change leaves open tabs in their mode; the next tab opened uses it. A hidden tab's webview
    // is gone (no retainContextWhenHidden): showing it again reloads it, and it gets the mode it
    // opened in, not the new value.
    await set('defaultMode', 'tree', 'json');
    await set('defaultMode', 'text');
    await sleep(SETTLE_MS);
    await open(json);
    await rendered(json, 'text');
    await open(jsonc);
    await rendered(jsonc, 'table');
    await open(later);
    await rendered(later, 'tree');
    console.log('criterion 3: open tabs keep their mode; the next tab uses the new value');
  } finally {
    await set('defaultMode', undefined, 'json');
    await set('defaultMode', undefined);
    await closeAll();
  }
  // With no setting, a tab opens in Tree as before.
  await open(json);
  await rendered(json, 'tree');
  await closeAll();

  // --- Criterion 8: validation on and off.
  const schema = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'validation/person.schema.json'), 'utf8'),
  );
  const person = copy('validation/person.jsonc', 'person.jsonc');
  const shown = () => view(person).validationsShown;
  await set('validation.enable', false);
  try {
    await open(person);
    assert.equal(hooks.setSchema(person.toString(), schema), true);
    await sleep(SETTLE_MS);
    assert.deepEqual(shown(), [], 'validation ran with chrJsonEditor.validation.enable false');
    let probe = await rendered(person, 'tree');
    assert.deepEqual(probe.validationMarks, [], 'marks with validation off');
    assert.doesNotMatch(probe.schemaStatus, /draft-07/, 'dialect notice with validation off');

    // On with the tab open: spec 004's errors show without reopening.
    await set('validation.enable', true);
    await waitFor('the validation result', () => shown().length > 0, 30000);
    assert.deepEqual(
      shown()
        .at(-1)
        .errors.map((e) => e.instancePath)
        .sort(),
      ['/age', '/email', '/name'],
    );
    const deadline = Date.now() + 10000;
    while ((probe = await hooks.probe(person.toString())).validationMarks.length === 0) {
      if (Date.now() > deadline) throw new Error('no validation marks after turning it on');
      await sleep(100);
    }
    assert.match(probe.schemaStatus, /assumed draft-07/);

    // Off again: the marks and the notice go.
    const before = shown().length;
    await set('validation.enable', false);
    await waitFor('validation to clear', () => shown().length > before);
    assert.deepEqual(shown().at(-1), {
      docVersion: shown().at(-1).docVersion,
      errors: null,
      reason: null,
      dialect: null,
    });
    const clearBy = Date.now() + 10000;
    while ((probe = await hooks.probe(person.toString())).validationMarks.length > 0) {
      if (Date.now() > clearBy) throw new Error('validation marks stayed after turning it off');
      await sleep(100);
    }
    assert.doesNotMatch(probe.schemaStatus, /draft-07/);
    await closeAll();
    console.log('criterion 8: validation off shows nothing; on and off apply to the open tab');

    // 12 MiB: off, no "Schema validation paused" item; on, the item shows (UNK-041); off, it goes.
    const twelve = write('twelve.json', documentText('json', TWELVE_MIB));
    await open(twelve);
    assert.equal(hooks.setSchema(twelve.toString(), { type: 'array', maxItems: 1 }), true);
    await sleep(SETTLE_MS);
    assert.equal(hooks.pausedValidation(), null, 'paused item with validation off');
    assert.deepEqual(view(twelve).validationsShown, []);
    await set('validation.enable', true);
    await waitFor('the paused item', () => hooks.pausedValidation() !== null);
    await set('validation.enable', false);
    await waitFor('the paused item to hide', () => hooks.pausedValidation() === null);
    console.log('criterion 8: at 12 MiB, no paused item while validation is off');
  } finally {
    await set('validation.enable', undefined);
    await closeAll();
  }

  // --- Criterion 11: Open Settings.
  hooks.openSettingsQueries();
  await vscode.commands.executeCommand(OPEN_SETTINGS_COMMAND);
  const isSettings = () => vscode.window.tabGroups.activeTabGroup.activeTab?.label === 'Settings';
  await waitFor('the Settings editor', isSettings);
  assert.deepEqual(hooks.openSettingsQueries(), [SETTINGS_QUERY]);
  // The search box is the workbench's own: read it through the clipboard, as a user would copy it.
  await vscode.env.clipboard.writeText('');
  await vscode.commands.executeCommand('settings.action.search');
  await vscode.commands.executeCommand('editor.action.selectAll');
  await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
  const search = await vscode.env.clipboard.readText();
  assert.equal(search.trim(), SETTINGS_QUERY, 'the Settings editor’s search');
  assert.ok(isSettings(), 'the Settings editor is no longer active');
  await closeAll();
  console.log('criterion 11: Open Settings shows the Settings editor searching for the extension');
};
