// Gate for 017 T3 and T4 (spec 017 criteria 5, 6 for JSON, JSONC, JSON5 and JSON Lines tabs, and
// 7), run by suite.cjs inside VS Code. "Convert YAML / TOML / XML to JSON" from the explorer, the
// text editor's title menu and the palette write `<name>.json` beside the source, byte for byte as
// tests/e2e/fixtures/import/<kind>/expected.json, and open it in the CHR JSON Editor; a taken name
// opens a save dialog prefilled with it, whose "Cancel" writes nothing; an untitled source gives an
// untitled JSON document (5). "Import YAML, TOML or XML…" asks, then replaces the document's data
// byte for byte as tests/import/replace/*/expected-after.* in one undoable edit; "Cancel" changes
// nothing; a JSON Lines tab takes an array only (6). A malformed file of each kind shows criterion
// 7's message and changes nothing; a conversion with warnings offers "Show Warnings" for the output
// channel (7). Also criterion 12's bundles: the three libraries are in both host entries and in no
// webview script. The fixtures are copied into run.mjs's scratch folder, so the copies never touch
// the repository's files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { CRITERION_6, DEFAULT_UNIT, reindent, withIndent } = require('./indent.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/import');
const REPLACE = path.resolve(__dirname, '../../../../tests/import/replace');
const COMMANDS = {
  yaml: 'chrJsonEditor.convertYamlToJson',
  toml: 'chrJsonEditor.convertTomlToJson',
  xml: 'chrJsonEditor.convertXmlToJson',
};
const IMPORT = 'chrJsonEditor.importFile';
const LABELS = { yaml: 'YAML', toml: 'TOML', xml: 'XML' };
const EXTENSIONS = { yaml: 'yaml|yml', toml: 'toml', xml: 'xml' };
/** The source fixture of each kind (tests/e2e/fixtures/import/<kind>/). */
const SOURCES = { yaml: 'config.yaml', toml: 'Cargo.toml', xml: 'data.xml' };
/** Criterion 7 on tests/e2e/fixtures/import/malformed/: the libraries' texts and places. */
const MALFORMED = {
  yaml:
    "CHR JSON Editor: can't convert broken.yaml: Flow sequence in block collection must be " +
    'sufficiently indented and end with a ] (line 2, column 1).',
  toml:
    "CHR JSON Editor: can't convert broken.toml: trying to redefine an already defined table or " +
    'value (line 2, column 1).',
  xml: "CHR JSON Editor: can't convert broken.xml: unexpected close tag. (line 2, column 9).",
};
/** Strings each library's code holds, to find it in a bundle (criterion 12). */
const LIBRARY_MARKERS = {
  yaml: 'Excessive alias count indicates a resource exhaustion attack',
  'smol-toml': 'integer value cannot be represented losslessly',
  saxes: 'http://www.w3.org/XML/1998/namespace',
};

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runImport = async function runImport({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const work = fs.mkdtempSync(path.join(scratch, 'import-'));
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;
  const read = (file) => fs.readFileSync(file, 'utf8');

  /** Copies `from` into a new folder as `to`. */
  function copy(from, to = path.basename(from)) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), to);
    fs.copyFileSync(from, file);
    return file;
  }

  async function openText(file) {
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await expectOnly(uri, 'text', isText);
    return document;
  }

  async function openCustom(file) {
    const uri = vscode.Uri.file(file);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the ${path.basename(file)} webview`, () => view()?.scriptLoaded);
    return uri;
  }

  const files = (file) => fs.readdirSync(path.dirname(file)).sort();

  try {
    // Criterion 12: the libraries are bundled into both host entries and into no webview script.
    const extension = vscode.extensions.getExtension('christian-vrl.chr-json-editor');
    const dist = path.join(extension.extensionPath, 'dist');
    for (const [library, marker] of Object.entries(LIBRARY_MARKERS)) {
      for (const host of ['extension.js', 'web/extension.js'])
        assert.ok(read(path.join(dist, host)).includes(marker), `${library} not in ${host}`);
      for (const page of fs
        .readdirSync(dist)
        .filter((f) => f.endsWith('.js') && f !== 'extension.js'))
        assert.ok(!read(path.join(dist, page)).includes(marker), `${library} in ${page}`);
    }

    // The menus: explorer and editor title on files of the kind, the palette everywhere; the
    // import in the palette and the CHR JSON Editor's title menu, hidden in a locked tab.
    const { commands, menus } = extension.packageJSON.contributes;
    const titles = Object.fromEntries(commands.map((c) => [c.command, c.title]));
    for (const kind of Object.keys(COMMANDS)) {
      assert.equal(titles[COMMANDS[kind]], `Convert ${LABELS[kind]} to JSON`);
      for (const menu of ['explorer/context', 'editor/title']) {
        const entry = menus[menu].find((m) => m.command === COMMANDS[kind]);
        assert.ok(entry, `${COMMANDS[kind]} is not in ${menu}`);
        assert.ok(
          entry.when.includes(`resourceExtname =~ /^\\.(${EXTENSIONS[kind]})$/i`),
          `${COMMANDS[kind]} in ${menu}: ${entry.when}`,
        );
      }
      assert.equal(
        menus.commandPalette.find((m) => m.command === COMMANDS[kind]),
        undefined,
        `${COMMANDS[kind]} is hidden from the palette`,
      );
    }
    assert.equal(titles[IMPORT], 'Import YAML, TOML or XML…');
    for (const menu of ['commandPalette', 'editor/title']) {
      assert.equal(
        menus[menu].find((m) => m.command === IMPORT)?.when,
        'activeCustomEditorId == chrJsonEditor.editor && !chrJsonEditor.customEditorLocked',
        `${IMPORT} in ${menu}`,
      );
    }

    hooks.imports({ saveAs: () => undefined, showWarnings: false });
    for (const [kind, command] of Object.entries(COMMANDS)) {
      const source = path.join(FIXTURES, kind, SOURCES[kind]);
      // The new file takes VS Code's indent for JSON (spec 019 I1, 4 spaces by default); the
      // fixture is written with 2.
      const expected = reindent(read(path.join(FIXTURES, kind, 'expected.json')), DEFAULT_UNIT);
      const original = read(source);

      // Criterion 5 from the explorer: the file beside, opened in the CHR JSON Editor.
      const file = copy(source);
      const target = path.join(path.dirname(file), SOURCES[kind].replace(/\.\w+$/, '.json'));
      await vscode.commands.executeCommand(command, vscode.Uri.file(file));
      assert.equal(read(target), expected, `${kind} (explorer): bytes`);
      assert.equal(read(file), original, `${kind} (explorer): the source changed`);
      await expectOnly(vscode.Uri.file(target), 'custom', isCustom);
      assert.deepEqual(hooks.imports(undefined), { saveAs: [], messages: [], output: [] });
      await closeAll();

      // From the editor title (the menu passes the URI): the name is taken now, so the save
      // dialog opens prefilled with it; "Cancel" writes nothing, a picked name is written.
      const document = await openText(file);
      hooks.imports({ saveAs: () => undefined });
      await vscode.commands.executeCommand(command, vscode.Uri.file(file));
      assert.deepEqual(hooks.imports(undefined).saveAs, [vscode.Uri.file(target).toString()]);
      assert.deepEqual(files(file), [path.basename(file), path.basename(target)].sort());
      const other = path.join(path.dirname(file), 'other.json');
      hooks.imports({ saveAs: () => vscode.Uri.file(other).toString() });
      await vscode.commands.executeCommand(command, vscode.Uri.file(file));
      assert.equal(read(other), expected, `${kind} (save dialog): bytes`);
      await expectOnly(vscode.Uri.file(other), 'custom', isCustom);
      assert.equal(document.isDirty, false, `${kind}: the source document changed`);
      await closeAll();

      // From the palette: the active editor's file of the kind.
      fs.rmSync(target);
      await openText(file);
      hooks.imports(undefined);
      await vscode.commands.executeCommand(command);
      assert.equal(read(target), expected, `${kind} (palette): bytes`);
      await expectOnly(vscode.Uri.file(target), 'custom', isCustom);
      await closeAll();

      // From the palette with no file of the kind open: the open dialog.
      const picked = copy(source);
      hooks.imports({ pick: () => vscode.Uri.file(picked).toString() });
      await vscode.commands.executeCommand(command);
      const pickedTarget = path.join(path.dirname(picked), path.basename(target));
      assert.equal(read(pickedTarget), expected, `${kind} (open dialog): bytes`);
      await closeAll();

      // Criterion 7: a malformed file gives the message, and nothing is written.
      const broken = copy(path.join(FIXTURES, 'malformed', `broken.${kind}`));
      hooks.imports(undefined);
      await vscode.commands.executeCommand(command, vscode.Uri.file(broken));
      assert.deepEqual(hooks.imports(undefined).messages, [MALFORMED[kind]], `${kind}: message`);
      assert.deepEqual(files(broken), [`broken.${kind}`], `${kind}: a malformed file wrote`);
      console.log(`import: Convert ${LABELS[kind]} to JSON from the explorer, title and palette`);
    }

    // Spec 019 criterion 6: "Convert YAML to JSON" takes "[json]"'s indent, 4 spaces or a tab.
    for (const [values, unit] of CRITERION_6) {
      await withIndent(waitFor, ['json'], values, async () => {
        hooks.imports({ saveAs: () => undefined, showWarnings: false });
        const file = copy(path.join(FIXTURES, 'yaml', SOURCES.yaml));
        const target = path.join(path.dirname(file), SOURCES.yaml.replace(/\.\w+$/, '.json'));
        await vscode.commands.executeCommand(COMMANDS.yaml, vscode.Uri.file(file));
        assert.equal(
          read(target),
          reindent(read(path.join(FIXTURES, 'yaml', 'expected.json')), unit),
          `yaml with ${JSON.stringify(values)}: bytes`,
        );
        hooks.imports(undefined);
        await closeAll();
      });
    }
    console.log('criterion 6: "Convert YAML to JSON" writes "[json]"\'s 4 spaces or a tab');

    // Criterion 5: an untitled source gives an untitled JSON document in the CHR JSON Editor.
    {
      const yaml = read(path.join(FIXTURES, 'yaml', SOURCES.yaml));
      const untitled = await vscode.workspace.openTextDocument({ language: 'yaml', content: yaml });
      await vscode.window.showTextDocument(untitled);
      await waitFor('the untitled YAML editor', () => isText(activeTab()));
      const before = new Set(vscode.workspace.textDocuments);
      await vscode.commands.executeCommand(COMMANDS.yaml);
      await waitFor('the untitled JSON document in the CHR JSON Editor', () => {
        const tab = activeTab();
        return tab && isCustom(tab) && tab.input.uri.scheme === 'untitled';
      });
      const created = vscode.workspace.textDocuments.find(
        (d) => !before.has(d) && d.uri.toString() === activeTab().input.uri.toString(),
      );
      assert.ok(created, 'no untitled JSON document');
      assert.equal(created.languageId, 'json');
      assert.equal(
        created.getText(),
        reindent(read(path.join(FIXTURES, 'yaml', 'expected.json')), DEFAULT_UNIT),
      );
      assert.equal(untitled.getText(), yaml, 'the untitled source changed');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
      console.log('import: an untitled YAML source gives an untitled JSON document');

      // A file on a read-only file system (as `git:` is) gives one too, and nothing is written.
      const bytes = new TextEncoder().encode(yaml);
      const readOnly = vscode.workspace.registerFileSystemProvider(
        'chr-read-only',
        {
          onDidChangeFile: new vscode.EventEmitter().event,
          watch: () => new vscode.Disposable(() => {}),
          stat: (uri) => {
            if (uri.path !== '/config.yaml') throw vscode.FileSystemError.FileNotFound(uri);
            return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length };
          },
          readDirectory: () => [['config.yaml', vscode.FileType.File]],
          readFile: (uri) => {
            if (uri.path !== '/config.yaml') throw vscode.FileSystemError.FileNotFound(uri);
            return bytes;
          },
          createDirectory: () => {
            throw vscode.FileSystemError.NoPermissions('read-only');
          },
          writeFile: () => {
            throw vscode.FileSystemError.NoPermissions('read-only');
          },
          delete: () => {
            throw vscode.FileSystemError.NoPermissions('read-only');
          },
          rename: () => {
            throw vscode.FileSystemError.NoPermissions('read-only');
          },
        },
        { isReadonly: true },
      );
      try {
        // The registration reaches the workbench, and comes back, a moment later.
        await waitFor(
          'the read-only file system to be known',
          () => vscode.workspace.fs.isWritableFileSystem('chr-read-only') === false,
        );
        await vscode.commands.executeCommand(
          COMMANDS.yaml,
          vscode.Uri.from({ scheme: 'chr-read-only', path: '/config.yaml' }),
        );
        await waitFor('the untitled JSON document of a read-only source', () => {
          const tab = activeTab();
          return tab && isCustom(tab) && tab.input.uri.scheme === 'untitled';
        });
        const shown = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === activeTab().input.uri.toString(),
        );
        assert.equal(
          shown.getText(),
          reindent(read(path.join(FIXTURES, 'yaml', 'expected.json')), DEFAULT_UNIT),
        );
        await vscode.commands.executeCommand('workbench.action.files.revert');
        await closeAll();
      } finally {
        readOnly.dispose();
      }
      console.log('import: a source on a read-only file system gives an untitled JSON document');
    }

    // Criterion 7: warnings go to the output channel, offered by the notification.
    {
      const file = copy(path.join(FIXTURES, 'warnings', 'stack.yaml'));
      hooks.imports({ showWarnings: true });
      await vscode.commands.executeCommand(COMMANDS.yaml, vscode.Uri.file(file));
      const seen = hooks.imports(undefined);
      assert.deepEqual(seen.messages, ['Converted stack.yaml with 2 warnings.']);
      assert.deepEqual(seen.output, [
        'stack.yaml:2: Tag !Ref was ignored (1 place)',
        'stack.yaml:3: The file holds 2 YAML documents; they became one array',
      ]);
      assert.equal(
        read(path.join(path.dirname(file), 'stack.json')),
        '[\n  {\n    "name": "web",\n    "port": "Port"\n  },\n  {\n    "name": "db"\n  }\n]\n',
      );
      await closeAll();
      console.log('import: warnings are listed in the output channel');
    }

    // Criterion 6: "Import YAML, TOML or XML…" asks, then replaces the data in one undoable edit.
    for (const name of fs.readdirSync(REPLACE).sort()) {
      const listed = fs.readdirSync(path.join(REPLACE, name));
      const beforeName = listed.find((f) => f.startsWith('before.'));
      const dataName = listed.find((f) => f.startsWith('data.'));
      const extension = path.extname(beforeName);
      const target = copy(path.join(REPLACE, name, beforeName), `doc${extension}`);
      const data = copy(path.join(REPLACE, name, dataName));
      const expected = read(path.join(REPLACE, name, `expected-after${extension}`));
      const original = read(target);
      const uri = await openCustom(target);
      const document = await vscode.workspace.openTextDocument(uri);
      const question =
        `Replace the data of doc${extension} with the data of ${dataName}? ` +
        'Comments on members that stay are kept.';

      hooks.imports({ pick: () => vscode.Uri.file(data).toString() });
      hooks.confirm(false);
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      assert.deepEqual(hooks.confirm(undefined), [question], `${name}: question`);
      assert.equal(document.getText(), original, `${name}: "Cancel" changed the document`);
      assert.equal(document.isDirty, false, `${name}: dirty after "Cancel"`);

      hooks.confirm(true);
      assert.equal(await vscode.commands.executeCommand(IMPORT), true);
      hooks.confirm(undefined);
      assert.deepEqual(hooks.imports(undefined).messages, [], `${name}: messages`);
      assert.equal(document.getText(), expected, `${name}: text after the import`);
      assert.equal(document.isDirty, true, `${name}: dirty`);
      assert.equal(read(target), original, `${name}: saved to disk`);
      await vscode.window.showTextDocument(document);
      await waitFor(`${name}: the text editor`, () => isText(activeTab()));
      await vscode.commands.executeCommand('undo');
      await waitFor(`${name}: one undo`, () => document.getText() === original);
      assert.equal(document.isDirty, false, `${name}: dirty after the undo`);
      await closeAll();
      console.log(`import: Import YAML, TOML or XML… on ${name} keeps comments, one undo`);
    }

    // Criterion 7 for the import: a malformed file changes nothing and is not asked about.
    {
      const target = copy(path.join(REPLACE, 'json-toml', 'before.json'), 'doc.json');
      const broken = copy(path.join(FIXTURES, 'malformed', 'broken.xml'));
      await openCustom(target);
      hooks.imports({ pick: () => vscode.Uri.file(broken).toString() });
      hooks.confirm(() => {
        throw new Error('asked about a malformed file');
      });
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      hooks.confirm(undefined);
      assert.deepEqual(hooks.imports(undefined).messages, [MALFORMED.xml]);
      assert.equal(read(target), read(path.join(REPLACE, 'json-toml', 'before.json')));
      await closeAll();
    }

    // Criterion 6 in a JSON Lines tab (017 T4): an array's items replace the lines (the jsonl-yaml
    // case above); any other value gives the message, is not asked about and changes nothing.
    {
      const before = read(path.join(REPLACE, 'jsonl-yaml', 'before.jsonl'));
      const target = copy(path.join(REPLACE, 'jsonl-yaml', 'before.jsonl'), 'doc.jsonl');
      const toml = copy(path.join(REPLACE, 'json-toml', 'data.toml'));
      const uri = await openCustom(target);
      const document = await vscode.workspace.openTextDocument(uri);
      hooks.imports({ pick: () => vscode.Uri.file(toml).toString() });
      hooks.confirm(() => {
        throw new Error('asked about data a JSON Lines tab cannot take');
      });
      assert.equal(await vscode.commands.executeCommand(IMPORT), false);
      hooks.confirm(undefined);
      assert.deepEqual(hooks.imports(undefined).messages, [
        'CHR JSON Editor: JSON Lines needs an array; data.toml holds an object.',
      ]);
      assert.equal(document.getText(), before, 'the JSON Lines document changed');
      assert.equal(document.isDirty, false, 'the JSON Lines document is dirty');
      await closeAll();
      console.log('import: a JSON Lines tab takes an array only');
    }
  } finally {
    hooks.imports(undefined);
    hooks.confirm(undefined);
  }
};
