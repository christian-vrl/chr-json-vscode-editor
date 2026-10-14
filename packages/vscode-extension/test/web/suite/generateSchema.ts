// Web e2e (016 T3; spec 016 criterion 10, spec 013 criterion 7): "Generate JSON Schema" on the
// virtual scheme, as test/e2e/generateSchema.cjs checks it on desktop (spec 016 criterion 5's `.json`
// case): data.schema.json is written beside the source, byte for byte as
// fixtures/generate-schema/expected.schema.json, and opened in the CHR JSON Editor it ran from, with
// the source unchanged; and (016 T5) when data.schema.json exists, a save dialog prefilled with it
// opens, and "Cancel" creates and changes no file.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  copyToCase,
  deepEqual,
  dirname,
  equal,
  expectOnly,
  fixture,
  list,
  openCustom,
  readText,
  writeText,
} from './util';

const COMMAND = 'chrJsonEditor.generateSchema';

describe('Generate JSON Schema on the virtual scheme (spec 016 criterion 10)', () => {
  it('Generate JSON Schema writes data.schema.json beside data.json', async () => {
    const hooks = await activateHooks();
    try {
      const source = await copyToCase(
        'generate-schema',
        fixture('fixtures', 'generate-schema', 'data.json'),
      );
      const original = await readText(source);
      const expected = await readText(
        fixture('fixtures', 'generate-schema', 'expected.schema.json'),
      );
      await openCustom(hooks, source);
      hooks.generateSchema({ link: false });
      await vscode.commands.executeCommand(COMMAND, source);
      const target = vscode.Uri.joinPath(dirname(source), 'data.schema.json');
      equal(await readText(target), expected, 'bytes');
      equal(await readText(source), original, 'the source changed');
      deepEqual(await list(dirname(source)), ['data.json', 'data.schema.json'], 'files');
      await expectOnly(target, 'custom');
      deepEqual(hooks.generateSchema(undefined).messages, [], 'messages');
      await closeAll();
    } finally {
      hooks.generateSchema(undefined);
    }
  });

  it('Generate JSON Schema opens a prefilled save dialog when data.schema.json exists', async () => {
    const hooks = await activateHooks();
    try {
      const source = await copyToCase(
        'generate-schema',
        fixture('fixtures', 'generate-schema', 'data.json'),
      );
      const original = await readText(source);
      const beside = await writeText(
        vscode.Uri.joinPath(dirname(source), 'data.schema.json'),
        '{}\n',
      );
      await openCustom(hooks, source);
      hooks.generateSchema({ saveAs: () => undefined, link: false });
      await vscode.commands.executeCommand(COMMAND, source);
      deepEqual(
        hooks.generateSchema(undefined),
        { saveAs: [beside.toString()], messages: [], notifications: [] },
        'Cancel: the prefilled dialog, and nothing shown after it',
      );
      equal(await readText(beside), '{}\n', 'Cancel changed the existing schema file');
      equal(await readText(source), original, 'the source changed');
      deepEqual(await list(dirname(source)), ['data.json', 'data.schema.json'], 'files');
      await expectOnly(source, 'custom');
      await closeAll();
    } finally {
      hooks.generateSchema(undefined);
    }
  });
});
