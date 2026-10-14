// Gate for 016 T3 (spec 016 criteria 5–7). Runs inside VS Code as the suite of run.mjs's second
// launch, which opens a workspace folder: criterion 7's "Use for …" button needs one, and adding the
// first folder to an open window would restart the extension host under the suite.
//
// - 5: "Generate JSON Schema" runs from the palette and from the editor-title menu (its `uri`
//   argument), in the CHR JSON Editor and the text editor, on fixtures/generate-schema/data.json,
//   .jsonc and .json5, writing data.schema.json beside each, byte for byte as expected.schema.json,
//   opened in the editor it ran from, the source unchanged; an existing schema file opens a save
//   dialog prefilled with it whose "Cancel" writes nothing; an untitled source, or one on a read-only
//   file system, gives an untitled JSON document holding the schema.
// - 6: a broken document gives spec 006 criterion 7's wording and nothing changes.
// - 7: the notification, the button only for a document in the folder with no schema today, its
//   `json.schemas` entry appended to the folder's settings (existing entries kept), and the open
//   document validated against the new schema with no errors, also in a path with spaces (016 T5).
// - 8 (016 T4): fixtures/generate-schema/lines.jsonl in the text editor and the CHR JSON Editor,
//   from the palette and the title menu (whose entries now list jsonl), writes lines.schema.json
//   byte for byte as lines.expected.schema.json (G8), with no button (criterion 7).
// - 9 (016 T4): in a locked large-file tab (spec 008's 6 MiB fixtures, largeFile.cjs
//   `documentText`) in each format the command writes the schema, shows "Generating JSON Schema…"
//   while it runs and leaves the tab locked, its text unchanged and no parse of it in core; above
//   the threshold the text editor shows the same notification, and at or below it none shows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';
const COMMAND = 'chrJsonEditor.generateSchema';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/generate-schema');
const FORMATS = ['json', 'jsonc', 'json5'];
const WHEN =
  '(activeCustomEditorId == chrJsonEditor.editor && chrJsonEditor.customEditorFormat =~ /^(json|jsonc|json5|jsonl)$/) || ' +
  '(activeEditor == workbench.editors.files.textFileEditor && chrJsonEditor.textEditorFormat =~ /^(json|jsonc|json5|jsonl)$/)';
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';
const THRESHOLD = 5 * 1024 * 1024;
const SIX_MIB = 6 * 1024 * 1024;
const GENERATING = 'Generating JSON Schema…';

/** The schema file of `schema` (spec 016 §Terms). */
const schemaFile = (schema) => `${JSON.stringify({ $schema: DRAFT_07, ...schema }, null, 2)}\n`;
const integer = { type: 'integer' };
const string = { type: 'string' };
/** Written by hand from G1–G4 for largeFile.cjs's SHAPES: one array of records whose first holds
 *  `marker`, whose middle ones hold the format's line and whose last holds `id` alone. */
const LARGE_SCHEMAS = {
  json: schemaFile({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: integer,
        marker: string,
        name: string,
        tags: { type: 'array', items: string },
      },
      required: ['id'],
    },
  }),
  jsonc: schemaFile({
    type: 'array',
    items: {
      type: 'object',
      properties: { id: integer, marker: string, name: string },
      required: ['id'],
    },
  }),
  json5: schemaFile({
    type: 'array',
    items: {
      type: 'object',
      properties: { id: integer, marker: string, name: string, hex: integer },
      required: ['id'],
    },
  }),
};

const isCustom = (tab) =>
  tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
const isText = (tab) => tab?.input instanceof vscode.TabInputText;
const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

async function waitFor(what, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function closeAll() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((g) => !g.tabs.length),
  );
}

/** Waits until `uri` is shown in one tab only, active, in the custom or the text editor. */
async function expectOnly(uri, custom) {
  await waitFor(`${uri.path} in the ${custom ? 'CHR JSON Editor' : 'text editor'}`, () => {
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input?.uri?.toString() === uri.toString());
    return tabs.length === 1 && (custom ? isCustom : isText)(tabs[0]) && activeTab() === tabs[0];
  });
}

/** A read-only file system with one file, as a `git:` document is (criterion 5). */
class ReadOnlyFiles {
  constructor(files) {
    this.files = files;
    this.onDidChangeFile = new vscode.EventEmitter().event;
  }
  watch() {
    return { dispose() {} };
  }
  stat(uri) {
    if (!this.files.has(uri.path)) throw vscode.FileSystemError.FileNotFound(uri);
    const size = this.files.get(uri.path).length;
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size };
  }
  readFile(uri) {
    if (!this.files.has(uri.path)) throw vscode.FileSystemError.FileNotFound(uri);
    return this.files.get(uri.path);
  }
  readDirectory() {
    return [];
  }
  createDirectory(uri) {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  writeFile(uri) {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  delete(uri) {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
  rename(uri) {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not installed`);
  const hooks = (await extension.activate())?.testHooks;
  assert.ok(hooks, 'no test hooks: build the .vsix with CHR_TEST_HOOKS=1');
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, 'run.mjs opens a workspace folder for this suite');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-schema-outside-'));
  const expected = fs.readFileSync(path.join(FIXTURES, 'expected.schema.json'), 'utf8');
  let cases = 0;

  /** Copies fixture `name` (or writes `text`) into a new folder under `parent`, and opens it. */
  async function open(name, { custom, parent = folder.uri.fsPath, text, prefix = 'case' } = {}) {
    const dir = path.join(parent, `${prefix}-${++cases}`);
    fs.mkdirSync(dir);
    const file = path.join(dir, name);
    if (text === undefined) fs.copyFileSync(path.join(FIXTURES, name), file);
    else fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    if (custom) await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    else await vscode.window.showTextDocument(document);
    await expectOnly(uri, custom);
    const key = custom ? 'chrJsonEditor.customEditorFormat' : 'chrJsonEditor.textEditorFormat';
    const format = path.extname(name).slice(1);
    await waitFor(`${name}: context key`, () => hooks.convert(undefined).context[key] === format);
    return { dir, file, uri, document, bytes: fs.readFileSync(file, 'utf8') };
  }

  try {
    // Criterion 5: the command and its palette and editor-title entries, for json, jsonc and json5
    // in both editors (the convert commands' context keys).
    const manifest = extension.packageJSON;
    const command = manifest.contributes.commands.find((c) => c.command === COMMAND);
    assert.equal(command?.title, 'Generate JSON Schema');
    assert.equal(command?.category, 'CHR JSON Editor');
    for (const menu of ['commandPalette', 'editor/title']) {
      const entry = manifest.contributes.menus[menu].find((m) => m.command === COMMAND);
      assert.equal(entry?.when, WHEN, `${menu} entry`);
    }

    // Criterion 5 and 7: each format in each editor; the palette (no argument) in the text editor
    // and the title menu (the document's URI) in the CHR JSON Editor. The source is in the folder
    // and has no schema, so the notification offers the button (dismissed here).
    for (const custom of [false, true]) {
      for (const format of FORMATS) {
        const name = `data.${format}`;
        const label = `${name} (${custom ? 'CHR JSON Editor' : 'text editor'})`;
        const { dir, file, uri, document, bytes } = await open(name, { custom });
        hooks.generateSchema({ link: false });
        await vscode.commands.executeCommand(COMMAND, ...(custom ? [uri] : []));
        const target = path.join(dir, 'data.schema.json');
        assert.equal(fs.readFileSync(target, 'utf8'), expected, `${label}: bytes`);
        assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${label}: the source file changed`);
        assert.equal(document.isDirty, false, `${label}: the source document changed`);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['data.schema.json', name].sort());
        await expectOnly(vscode.Uri.file(target), custom);
        assert.deepEqual(hooks.generateSchema({ link: false }), {
          saveAs: [],
          messages: [],
          notifications: [
            { message: `Generated data.schema.json from ${name}.`, button: `Use for ${name}` },
          ],
          progress: [],
        });
        await closeAll();
      }
    }
    console.log(
      'Generate JSON Schema: json, jsonc and json5 in both editors, palette and title menu',
    );

    // Criterion 5 (UNK-035): the schema file exists, so a save dialog prefilled with it opens;
    // "Cancel" writes nothing, and a picked name is written there.
    {
      const { dir, file, uri, bytes } = await open('data.json', { custom: true });
      const beside = path.join(dir, 'data.schema.json');
      fs.writeFileSync(beside, '{}\n');
      hooks.generateSchema({ saveAs: () => undefined, link: false });
      await vscode.commands.executeCommand(COMMAND);
      let seen = hooks.generateSchema({ saveAs: () => undefined, link: false });
      assert.deepEqual(seen.saveAs, [vscode.Uri.file(beside).toString()], 'prefilled save dialog');
      assert.deepEqual(seen.notifications, [], 'Cancel: no notification');
      assert.deepEqual(fs.readdirSync(dir).sort(), ['data.json', 'data.schema.json']);
      assert.equal(fs.readFileSync(beside, 'utf8'), '{}\n', 'Cancel changed the existing file');
      await expectOnly(uri, true);

      const other = path.join(dir, 'other.schema.json');
      hooks.generateSchema({ saveAs: () => vscode.Uri.file(other).toString(), link: false });
      await vscode.commands.executeCommand(COMMAND);
      seen = hooks.generateSchema({ link: false });
      assert.equal(fs.readFileSync(other, 'utf8'), expected);
      assert.equal(fs.readFileSync(beside, 'utf8'), '{}\n');
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.deepEqual(seen.notifications, [
        { message: 'Generated other.schema.json from data.json.', button: 'Use for data.json' },
      ]);
      await expectOnly(vscode.Uri.file(other), true);
      await closeAll();
      console.log('Generate JSON Schema: an existing schema file opens a prefilled save dialog');
    }

    // Criterion 5: an untitled source, and one on a read-only file system (as `git:` is), give an
    // untitled JSON document with the schema; no button (criterion 7).
    {
      const source = fs.readFileSync(path.join(FIXTURES, 'data.jsonc'), 'utf8');
      const untitled = await vscode.workspace.openTextDocument({
        language: 'jsonc',
        content: source,
      });
      await vscode.window.showTextDocument(untitled);
      const readOnly = vscode.workspace.registerFileSystemProvider(
        'chr-readonly',
        new ReadOnlyFiles(
          new Map([['/data.json5', fs.readFileSync(path.join(FIXTURES, 'data.json5'))]]),
        ),
        { isReadonly: true },
      );
      try {
        const sources = [
          { document: untitled, name: path.basename(untitled.uri.path) },
          {
            document: await vscode.window
              .showTextDocument(vscode.Uri.from({ scheme: 'chr-readonly', path: '/data.json5' }))
              .then((editor) => editor.document),
            name: 'data.json5',
          },
        ];
        for (const { document, name } of sources) {
          await vscode.window.showTextDocument(document);
          hooks.generateSchema({ link: true });
          await vscode.commands.executeCommand(COMMAND);
          await waitFor(`${name}: the untitled schema document`, () => {
            const tab = activeTab();
            return (
              isText(tab) &&
              tab.input.uri.scheme === 'untitled' &&
              tab.input.uri.toString() !== untitled.uri.toString()
            );
          });
          const created = vscode.window.activeTextEditor.document;
          assert.equal(created.getText(), expected, `${name}: schema text`);
          assert.equal(created.languageId, 'json', `${name}: language`);
          assert.deepEqual(hooks.generateSchema(undefined).notifications, [
            {
              message: `Generated ${path.basename(created.uri.path)} from ${name}.`,
              button: undefined,
            },
          ]);
          assert.equal(
            vscode.workspace.getConfiguration('json', folder.uri).inspect('schemas')
              ?.workspaceFolderValue,
            undefined,
            `${name}: json.schemas changed`,
          );
        }
      } finally {
        readOnly.dispose();
      }
      assert.equal(untitled.getText(), source, 'the untitled source changed');
      // Untitled documents are dirty: revert each, so closing asks nothing.
      for (let i = 0; i < 10 && activeTab(); i++) {
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      }
      await closeAll();
      console.log('Generate JSON Schema: untitled and read-only sources give an untitled document');
    }

    // Criterion 6: no source data, no schema; the message is spec 006 criterion 7's.
    for (const custom of [false, true]) {
      const { dir, file, document, bytes } = await open('broken.jsonc', {
        custom,
        text: '{\n  "a": 1,\n  "b": }\n',
      });
      hooks.generateSchema({ link: true });
      await vscode.commands.executeCommand(COMMAND);
      assert.deepEqual(hooks.generateSchema(undefined), {
        saveAs: [],
        messages: [
          "CHR JSON Editor: can't generate a JSON Schema: the document is not valid JSONC (error " +
            'at line 3, column 8). Fix it or run "Repair JSON" first.',
        ],
        notifications: [],
        progress: [],
      });
      assert.deepEqual(fs.readdirSync(dir), ['broken.jsonc']);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.equal(document.isDirty, false);
      assert.equal(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, 1, 'a tab opened');
      await closeAll();
    }
    console.log('Generate JSON Schema: a broken document gives no schema');

    // Criterion 7: no button outside every workspace folder, for a document that has a schema
    // already (its own `$schema`), or for a JSON Lines document.
    for (const { name, text, parent } of [
      { name: 'outside.json', text: '{"a": 1}\n', parent: outside },
      { name: 'own.json', text: '{"$schema": "./s.json", "a": 1}\n' },
      { name: 'lines.jsonl', text: '{"a": 1}\n{"a": 2}\n' },
    ]) {
      const { dir } = await open(name, { parent, text });
      hooks.generateSchema({ link: true });
      await vscode.commands.executeCommand(COMMAND);
      const schemaFile = name.replace(/\.\w+$/, '.schema.json');
      assert.ok(fs.existsSync(path.join(dir, schemaFile)), `${name}: no schema file`);
      assert.deepEqual(hooks.generateSchema(undefined).notifications, [
        { message: `Generated ${schemaFile} from ${name}.`, button: undefined },
      ]);
      await closeAll();
    }
    assert.equal(
      vscode.workspace.getConfiguration('json', folder.uri).inspect('schemas')
        ?.workspaceFolderValue,
      undefined,
      'json.schemas changed without a button',
    );
    console.log(
      'Generate JSON Schema: no button outside the folder, with a schema, or for JSON Lines',
    );

    // Criterion 7: "Use for data.json5" appends the entry to the folder's json.schemas, keeping
    // the entry already there, and the open document is validated against the new schema with no
    // errors (004's validation in the CHR JSON Editor).
    {
      const configuration = () => vscode.workspace.getConfiguration('json', folder.uri);
      const existing = { fileMatch: ['/elsewhere/*.json'], url: './elsewhere.schema.json' };
      await configuration().update(
        'schemas',
        [existing],
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      const { dir, uri } = await open('data.json5', { custom: true });
      const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
      await waitFor('the data.json5 webview script to run', () => view()?.scriptLoaded);
      assert.deepEqual(view().validationsShown, [], 'validated before it had a schema');
      hooks.generateSchema({ link: true });
      await vscode.commands.executeCommand(COMMAND);
      assert.deepEqual(hooks.generateSchema(undefined).notifications, [
        { message: 'Generated data.schema.json from data.json5.', button: 'Use for data.json5' },
      ]);
      const relative = path.relative(folder.uri.fsPath, dir).split(path.sep).join('/');
      assert.deepEqual(configuration().inspect('schemas')?.workspaceFolderValue, [
        existing,
        { fileMatch: [`/${relative}/data.json5`], url: `./${relative}/data.schema.json` },
      ]);
      // The source's tab is behind the schema's; bring it back so its webview reports what it shows.
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(
        'data.json5 active again',
        () => isCustom(activeTab()) && activeTab().input.uri.toString() === uri.toString(),
      );
      await waitFor('data.json5 validated against its new schema', () => {
        const last = view().validationsShown.at(-1);
        return last !== undefined && last.reason === null;
      });
      const last = view().validationsShown.at(-1);
      assert.deepEqual(last.errors, [], 'errors against the new schema');
      assert.deepEqual(last.dialect, { name: 'draft-07', assumed: false, switchable: false });
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(dir, 'data.schema.json'), 'utf8')).$schema,
        DRAFT_07,
      );
      await configuration().update(
        'schemas',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await closeAll();
      console.log('Generate JSON Schema: "Use for data.json5" links the schema; no errors');
    }

    // Criterion 7 with spaces in the folder and file names (016 T3 review): the entry's paths keep
    // the spaces unencoded, which is how spec 004's resolver spells the document's URI
    // (`Uri.toString(true)`), so the document is validated against the new schema with no errors.
    {
      const configuration = () => vscode.workspace.getConfiguration('json', folder.uri);
      const name = 'my data.json';
      const { dir, uri } = await open(name, {
        custom: true,
        prefix: 'case with spaces',
        text: fs.readFileSync(path.join(FIXTURES, 'data.json'), 'utf8'),
      });
      const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
      await waitFor(`the ${name} webview script to run`, () => view()?.scriptLoaded);
      assert.deepEqual(view().validationsShown, [], 'validated before it had a schema');
      hooks.generateSchema({ link: true });
      await vscode.commands.executeCommand(COMMAND);
      assert.deepEqual(hooks.generateSchema(undefined).notifications, [
        { message: `Generated my data.schema.json from ${name}.`, button: `Use for ${name}` },
      ]);
      assert.equal(fs.readFileSync(path.join(dir, 'my data.schema.json'), 'utf8'), expected);
      const relative = path.relative(folder.uri.fsPath, dir).split(path.sep).join('/');
      assert.ok(relative.includes(' '), relative);
      assert.deepEqual(configuration().inspect('schemas')?.workspaceFolderValue, [
        { fileMatch: [`/${relative}/my data.json`], url: `./${relative}/my data.schema.json` },
      ]);
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(
        `${name} active again`,
        () => isCustom(activeTab()) && activeTab().input.uri.toString() === uri.toString(),
      );
      await waitFor(`${name} validated against its new schema`, () => {
        const last = view().validationsShown.at(-1);
        return last !== undefined && last.reason === null;
      });
      const last = view().validationsShown.at(-1);
      assert.deepEqual(last.errors, [], 'errors against the new schema');
      assert.deepEqual(last.dialect, { name: 'draft-07', assumed: false, switchable: false });
      await configuration().update(
        'schemas',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await closeAll();
      console.log('Generate JSON Schema: "Use for" links a schema in a path with spaces');
    }

    // Criterion 8 (016 T4, G8): lines.jsonl in the text editor from the palette and in the CHR
    // JSON Editor from the title menu; the schema of one line, byte for byte, and no button.
    {
      const linesExpected = fs.readFileSync(
        path.join(FIXTURES, 'lines.expected.schema.json'),
        'utf8',
      );
      for (const custom of [false, true]) {
        const label = `lines.jsonl (${custom ? 'CHR JSON Editor' : 'text editor'})`;
        const { dir, file, uri, document, bytes } = await open('lines.jsonl', { custom });
        hooks.generateSchema({ link: true });
        await vscode.commands.executeCommand(COMMAND, ...(custom ? [uri] : []));
        const target = path.join(dir, 'lines.schema.json');
        assert.equal(fs.readFileSync(target, 'utf8'), linesExpected, `${label}: bytes`);
        assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${label}: the source file changed`);
        assert.equal(document.isDirty, false, `${label}: the source document changed`);
        assert.deepEqual(fs.readdirSync(dir).sort(), ['lines.jsonl', 'lines.schema.json']);
        await expectOnly(vscode.Uri.file(target), custom);
        assert.deepEqual(hooks.generateSchema(undefined), {
          saveAs: [],
          messages: [],
          notifications: [
            { message: 'Generated lines.schema.json from lines.jsonl.', button: undefined },
          ],
          progress: [],
        });
        await closeAll();
      }
      assert.equal(
        vscode.workspace.getConfiguration('json', folder.uri).inspect('schemas')
          ?.workspaceFolderValue,
        undefined,
        'json.schemas changed for JSON Lines',
      );
      console.log('Generate JSON Schema: lines.jsonl in both editors gives the schema of one line');
    }

    // Criterion 9 (016 T4): a locked large-file tab in each format, from the palette (json) and
    // the title menu (jsonc, json5): the schema is written under the progress notification, and
    // the tab stays locked with its text unchanged and no parse of it kept in core.
    for (const format of FORMATS) {
      const name = `six.${format}`;
      const text = documentText(format, SIX_MIB);
      const { dir, file, uri, document } = await open(name, { custom: true, text });
      const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
      await waitFor(`the ${name} webview script to run`, () => view()?.scriptLoaded, 60000);
      const locked = { bytes: SIX_MIB, unlocked: false };
      assert.deepEqual(view().largeFile, locked, `${name}: not a locked large-file tab`);
      hooks.generateSchema({ link: false });
      await vscode.commands.executeCommand(COMMAND, ...(format === 'json' ? [] : [uri]));
      const target = path.join(dir, 'six.schema.json');
      assert.equal(fs.readFileSync(target, 'utf8'), LARGE_SCHEMAS[format], `${name}: bytes`);
      const seen = hooks.generateSchema(undefined);
      assert.deepEqual(seen.progress, [GENERATING], `${name}: progress notification`);
      assert.deepEqual(seen.messages, [], `${name}: messages`);
      assert.deepEqual(seen.notifications, [
        { message: `Generated six.schema.json from ${name}.`, button: `Use for ${name}` },
      ]);
      await expectOnly(vscode.Uri.file(target), true);
      assert.equal(document.getText(), text, `${name}: the text changed`);
      assert.equal(document.isDirty, false, `${name}: the document changed`);
      assert.equal(fs.readFileSync(file, 'utf8'), text, `${name}: the file changed`);
      assert.ok(!hooks.cachedParses().includes(text), `${name}: core keeps a parse of the text`);
      // Back to the source's tab: still the same locked large-file tab.
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(
        `${name} active again`,
        () => isCustom(activeTab()) && activeTab().input.uri.toString() === uri.toString(),
      );
      assert.deepEqual(view().largeFile, locked, `${name}: the tab is no longer locked`);
      await closeAll();
    }
    console.log('Generate JSON Schema: locked 6 MiB tabs in each format, under progress');

    // Criterion 9: the threshold, in UTF-8 bytes of the text, in the text editor too: above it the
    // progress notification shows; at it, none.
    for (const [bytes, progress] of [
      [THRESHOLD + 1, [GENERATING]],
      [THRESHOLD, []],
    ]) {
      const { dir } = await open('size.json', { text: documentText('json', bytes) });
      hooks.generateSchema({ link: false });
      await vscode.commands.executeCommand(COMMAND);
      assert.equal(
        fs.readFileSync(path.join(dir, 'size.schema.json'), 'utf8'),
        LARGE_SCHEMAS.json,
        `${bytes} bytes: schema`,
      );
      assert.deepEqual(hooks.generateSchema(undefined).progress, progress, `${bytes} bytes`);
      await closeAll();
    }
    console.log('Generate JSON Schema: progress above the 5 MiB threshold only');
  } finally {
    hooks.generateSchema(undefined);
    fs.rmSync(outside, { recursive: true, force: true });
  }
};
