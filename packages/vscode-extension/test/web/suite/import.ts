// Web e2e (017 T3, spec 017 criterion 11; spec 013 criterion 7): "Convert YAML / TOML / XML to
// JSON" and "Import YAML, TOML or XML…" on the virtual scheme, as test/e2e/import.cjs checks them on
// desktop (spec 017 criteria 5 and 6): each convert writes `<name>.json` beside the source, byte for
// byte as fixtures/import/<kind>/expected.json, opened in the CHR JSON Editor, with the source
// unchanged; the import asks, then replaces the document's data in one undoable edit. Each case
// works on copies under work/.
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
  openCustom,
  readText,
  waitFor,
} from './util';

const COMMANDS = {
  yaml: 'chrJsonEditor.convertYamlToJson',
  toml: 'chrJsonEditor.convertTomlToJson',
  xml: 'chrJsonEditor.convertXmlToJson',
} as const;
const IMPORT = 'chrJsonEditor.importFile';
const SOURCES = { yaml: 'config.yaml', toml: 'Cargo.toml', xml: 'data.xml' } as const;

describe('YAML, TOML and XML commands on the virtual scheme (spec 017 criterion 11)', () => {
  it('Convert YAML, TOML and XML to JSON write a new JSON file beside the source', async () => {
    const hooks = await activateHooks();
    try {
      hooks.imports({ showWarnings: false });
      for (const kind of ['yaml', 'toml', 'xml'] as const) {
        const source = await copyToCase(
          `import-${kind}`,
          fixture('fixtures', 'import', kind, SOURCES[kind]),
        );
        const original = await readText(source);
        const expected = await readText(fixture('fixtures', 'import', kind, 'expected.json'));
        const target = vscode.Uri.joinPath(
          dirname(source),
          SOURCES[kind].replace(/\.\w+$/, '.json'),
        );
        await vscode.commands.executeCommand(COMMANDS[kind], source);
        equal(await readText(target), expected, `${kind}: bytes`);
        equal(await readText(source), original, `${kind}: the source changed`);
        await expectOnly(target, 'custom');
        deepEqual(hooks.imports({ showWarnings: false }).messages, [], `${kind}: messages`);
        await closeAll();
      }
    } finally {
      hooks.imports(undefined);
    }
  });

  it("Import YAML, TOML or XML… replaces the document's data in one undoable edit", async () => {
    const hooks = await activateHooks();
    try {
      const target = await copyToCase(
        'import-replace',
        fixture('import', 'replace', 'jsonc-yaml', 'before.jsonc'),
        'doc.jsonc',
      );
      const data = await copyToCase(
        'import-replace',
        fixture('import', 'replace', 'jsonc-yaml', 'data.yaml'),
      );
      const expected = await readText(
        fixture('import', 'replace', 'jsonc-yaml', 'expected-after.jsonc'),
      );
      const original = await readText(target);
      const document = await openCustom(hooks, target);
      hooks.imports({ pick: () => data.toString(), showWarnings: false });
      hooks.confirm(true);
      equal(await vscode.commands.executeCommand(IMPORT), true, 'the import ran');
      deepEqual(
        hooks.confirm(undefined),
        [
          'Replace the data of doc.jsonc with the data of data.yaml? ' +
            'Comments on members that stay are kept.',
        ],
        'question',
      );
      equal(document.getText(), expected, 'text after the import');
      equal(document.isDirty, true, 'dirty');
      await vscode.window.showTextDocument(document);
      await waitFor('the text editor', () => isText(activeTab()));
      await vscode.commands.executeCommand('undo');
      await waitFor('one undo', () => document.getText() === original);
      equal(document.isDirty, false, 'dirty after the undo');
      await closeAll();
    } finally {
      hooks.confirm(undefined);
      hooks.imports(undefined);
    }
  });
});
