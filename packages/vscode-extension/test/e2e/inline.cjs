// Gate (004 T5, spec 004 criterion 5): schema errors appear inline in tree, table and text modes
// for .json, .jsonc and .json5 documents. The schema reaches each document through the association
// rules (criterion 1) as VS Code users set them: `json.schemas` for people.json and people.jsonc,
// `json5.schemas` (the Better JSON5 extension's setting, unregistered here) for people.json5, and
// limits.jsonc's own `$schema`. Read from the rendered webview (webview/testHooks.ts), not from
// the messages: an icon at the node or cell in tree and table mode, an underline in text mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
const INLINE = path.resolve(__dirname, '../../../../tests/e2e/fixtures/inline');

/** people.* break people.schema.json at these pointers (sorted as the validator sorts). */
const PEOPLE_ERRORS = [
  { instancePath: '/1/age', keyword: 'type' },
  { instancePath: '/1/name', keyword: 'minLength' },
];
/** The keys text mode underlines for those errors, as each format writes them. */
const UNDERLINED = {
  json: ['"age"', '"name"'],
  jsonc: ['"age"', '"name"'],
  json5: ['age', 'name'],
};

const keys = (errors) =>
  (errors ?? []).map(({ instancePath, keyword }) => ({ instancePath, keyword }));

/** True when `pointer` is `path` or inside it. */
const within = (pointer, path) => pointer === path || pointer.startsWith(`${path}/`);

exports.runInline = async function runInline({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const settingsFile = process.env.CHR_E2E_USER_SETTINGS;
  assert.ok(settingsFile, 'CHR_E2E_USER_SETTINGS is not set (see run.mjs)');
  const original = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : undefined;
  const schemaUrl = pathToFileURL(path.join(INLINE, 'people.schema.json')).href;

  // User settings, written to the file as a user would: VS Code refuses `update` for a setting no
  // installed extension registers, which `json5.schemas` is without Better JSON5.
  const settings = original ? JSON.parse(original) : {};
  settings['json.schemas'] = [
    { fileMatch: ['/inline/people.json', '/inline/people.jsonc'], url: schemaUrl },
  ];
  settings['json5.schemas'] = [{ fileMatch: ['/inline/people.json5'], url: schemaUrl }];
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  const globalValue = (section) =>
    vscode.workspace.getConfiguration(section).inspect('schemas')?.globalValue;
  await waitFor('json.schemas and json5.schemas from settings.json', () =>
    ['json', 'json5'].every((section) => Array.isArray(globalValue(section))),
  );

  const open = async (file) => {
    const uri = vscode.Uri.file(path.join(INLINE, file));
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the ${file} webview script to run`, () => view()?.scriptLoaded);
    const shown = () => view().validationsShown;
    return { uri, key: uri.toString(), shown, last: () => shown().at(-1) };
  };

  /** Polls the rendered webview until `check` passes on a probe of `mode`. */
  const rendered = async (key, mode, what, check) => {
    const deadline = Date.now() + 10000;
    let probe;
    for (;;) {
      probe = await hooks.probe(key);
      if (probe.mode === mode && check(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(
          `${what}: ${mode} mode never showed it; last probe: mode ${probe.mode}, ` +
            `marks ${JSON.stringify(probe.validationMarks)}, schema "${probe.schemaStatus}"`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  /** Tree: every error has an icon at its node or at a collapsed ancestor holding it. */
  const treeShows = (errors) => (probe) => {
    const paths = probe.validationMarks.map((m) => m.path).filter((p) => p !== null);
    return (
      paths.length > 0 &&
      errors.every(({ instancePath }) => paths.some((p) => within(instancePath, p))) &&
      paths.every((p) => errors.some(({ instancePath }) => within(instancePath, p)))
    );
  };
  /** Table: an icon in exactly the cells of the errors. */
  const tableShows = (errors) => (probe) => {
    const paths = probe.validationMarks.map((m) => m.path).filter((p) => p !== null);
    return (
      JSON.stringify([...paths].sort()) === JSON.stringify(errors.map((e) => e.instancePath).sort())
    );
  };
  /** Text: an underline over exactly these spans of the text. */
  const textShows = (spans) => (probe) =>
    JSON.stringify(probe.validationMarks.map((m) => m.text).sort()) ===
    JSON.stringify([...spans].sort());

  for (const format of ['json', 'jsonc', 'json5']) {
    await closeAll();
    const name = `people.${format}`;
    const doc = await open(name);
    await waitFor(
      `${name}: schema errors from ${format === 'json5' ? 'json5' : 'json'}.schemas`,
      () => doc.shown().some((v) => v.errors?.length),
    );
    assert.deepEqual(keys(doc.last().errors), PEOPLE_ERRORS, `${name}: errors`);
    assert.deepEqual(doc.last().dialect, { name: 'draft-07', assumed: true, switchable: true });

    for (const mode of ['tree', 'table', 'text']) {
      assert.equal(hooks.setMode(doc.key, mode), true);
      const check =
        mode === 'tree'
          ? treeShows(PEOPLE_ERRORS)
          : mode === 'table'
            ? tableShows(PEOPLE_ERRORS)
            : textShows(UNDERLINED[format]);
      const probe = await rendered(doc.key, mode, `${name} errors inline`, check);
      assert.equal(probe.schemaStatus, 'assumed draft-07', `${name} ${mode}: toolbar`);
      assert.deepEqual(probe.violations, [], `${name} ${mode}: CSP violations`);
      console.log(
        `${name} ${mode}: ${probe.validationMarks.length} inline mark(s) ` +
          JSON.stringify(probe.validationMarks.map((m) => m.path ?? m.text)),
      );
    }

    // An edit in the editor is validated again, and the marks follow it.
    assert.equal(hooks.setMode(doc.key, 'table'), true);
    assert.equal(hooks.patch(doc.key, [{ op: 'replace', path: '/1/age', value: 7 }]), true);
    await rendered(doc.key, 'table', `${name} after fixing /1/age`, tableShows([PEOPLE_ERRORS[1]]));
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await rendered(doc.key, 'table', `${name} after revert`, tableShows(PEOPLE_ERRORS));
    console.log(`${name}: the marks follow an edit and its revert`);
  }

  // Validation follows the format badge (003 T10): as JSON, people.json5 does not parse, so it is
  // not validated and the toolbar says why; back as JSON5 the errors return.
  const json5 = await open('people.json5');
  await rendered(json5.key, 'table', 'people.json5 errors', tableShows(PEOPLE_ERRORS));
  await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json');
  await waitFor('people.json5 validated as JSON', () => json5.last().reason !== null);
  assert.match(json5.last().reason, /does not parse/);
  const skipped = await hooks.probe(json5.key);
  assert.match(skipped.schemaStatus, /^assumed draft-07 Not validated: .*does not parse/);
  await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json5');
  await waitFor('people.json5 validated as JSON5', () => json5.last().errors?.length === 2);
  console.log('people.json5: validation follows the format badge');

  // A document's own relative `$schema` (criterion 1's first rule), naming a schema with no
  // `$schema`: assumed draft-07, under which `exclusiveMinimum: true` does not compile. The toolbar
  // switch (UNK-017) re-validates it as draft-04, where it means "greater than".
  await closeAll();
  const limits = await open('limits.jsonc');
  await waitFor('limits.jsonc validated', () => limits.last()?.reason);
  assert.match(limits.last().reason, /exclusiveMinimum must be number/);
  assert.deepEqual(limits.last().dialect, { name: 'draft-07', assumed: true, switchable: true });
  const before = await hooks.probe(limits.key);
  assert.match(before.schemaStatus, /^assumed draft-07 Not validated: The schema does not compile/);
  assert.equal(hooks.selectDialect(limits.key, 'draft-04'), true);
  await waitFor('limits.jsonc as draft-04', () => limits.last().dialect?.name === 'draft-04');
  assert.deepEqual(limits.last().dialect, { name: 'draft-04', assumed: false, switchable: true });
  assert.deepEqual(keys(limits.last().errors), [{ instancePath: '/count', keyword: 'minimum' }]);
  const after = await rendered(
    limits.key,
    'tree',
    'limits.jsonc as draft-04',
    treeShows([{ instancePath: '/count' }]),
  );
  assert.equal(after.schemaStatus, 'draft-04');
  console.log('limits.jsonc: its $schema applies, and the dialect switch re-validates as draft-04');

  // An unsaved edit to the schema in another tab applies at once (the binding reads the open
  // document, not the file), and keeps the dialect the user chose for that schema.
  const schemaDoc = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(INLINE, 'limits.schema.json')),
  );
  const loosen = new vscode.WorkspaceEdit();
  const minimum = schemaDoc.getText().indexOf('"minimum": 0');
  assert.ok(minimum >= 0, 'limits.schema.json: no "minimum": 0');
  loosen.replace(
    schemaDoc.uri,
    new vscode.Range(
      schemaDoc.positionAt(minimum),
      schemaDoc.positionAt(minimum + '"minimum": 0'.length),
    ),
    '"minimum": -1',
  );
  assert.equal(await vscode.workspace.applyEdit(loosen), true);
  await waitFor(
    'limits.jsonc re-validated against the edited schema',
    () => Array.isArray(limits.last().errors) && limits.last().errors.length === 0,
  );
  assert.equal(limits.last().dialect?.name, 'draft-04');
  await rendered(limits.key, 'tree', 'limits.jsonc valid', (p) => !p.validationMarks.length);
  // Beside, so limits.jsonc's webview stays visible (a hidden webview drops its messages).
  await vscode.window.showTextDocument(schemaDoc, vscode.ViewColumn.Beside);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('the schema edit to revert', () => !schemaDoc.isDirty);
  await waitFor('limits.jsonc invalid again', () => limits.last().errors?.length === 1);
  console.log('limits.jsonc: an unsaved edit to its schema in another tab re-validates it');

  // Removing the settings drops the schema: the open editor is told, and its marks go.
  await closeAll();
  const people = await open('people.json');
  await rendered(people.key, 'tree', 'people.json errors', treeShows(PEOPLE_ERRORS));
  // Rewritten, not deleted: VS Code stops watching a settings file that goes away.
  fs.writeFileSync(settingsFile, original ?? '{}\n');
  await waitFor('the settings to go', () => globalValue('json') === undefined);
  await waitFor('people.json told it has no schema', () => people.last().dialect === null);
  await rendered(
    people.key,
    'tree',
    'people.json without a schema',
    (p) => !p.validationMarks.length,
  );
  assert.equal((await hooks.probe(people.key)).schemaStatus, '');
  await closeAll();
  console.log('people.json: no schema once the settings are gone');
};
