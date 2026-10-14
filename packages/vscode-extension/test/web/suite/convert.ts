// Web e2e (013 T4, spec 013 criterion 7): "Convert to JSON / JSONC / JSON5" on the virtual scheme,
// as test/e2e/convert.cjs checks it on desktop (spec 006 criteria 6 and 7): from the text editor
// and the CHR JSON Editor, every pair writes a new file beside the document with the target's
// extension, opened in the same kind of editor; losses ask first and "Cancel" writes nothing; a
// UTF-8 byte order mark stays the new file's encoding mark; a broken document is not converted.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  deepEqual,
  dirname,
  equal,
  exists,
  expectOnly,
  list,
  manifest,
  openCustom,
  openText,
  readText,
  waitFor,
  writeToCase,
} from './util';
import type { TestHooks } from '../../../src/extension';

const FORMATS = ['json', 'jsonc', 'json5'] as const;
type Format = (typeof FORMATS)[number];
const LABELS = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };
const COMMANDS = {
  json: 'chrJsonEditor.convertToJson',
  jsonc: 'chrJsonEditor.convertToJsonc',
  json5: 'chrJsonEditor.convertToJson5',
};
const BOM = '﻿';

/** One source per format, and what each conversion writes and asks (convert.cjs). */
const SOURCES: Record<Format, string> = {
  json: '{\n  "a": [1, 2.5e3],\n  "b": "x"\n}\n',
  jsonc: '{\n  // keep\n  "a": 1,\n}\n',
  json5: "{\n  a: 'x', // c\n  n: NaN,\n  h: 0x1F,\n}\n",
};
const RESULTS: Record<string, { text: string; asked?: string }> = {
  'json-jsonc': { text: SOURCES.json },
  'json-json5': { text: SOURCES.json },
  'jsonc-json': {
    text: '{\n  "a": 1\n}\n',
    asked: 'Converting to JSON removes 1 comment. Convert anyway?',
  },
  'jsonc-json5': { text: SOURCES.jsonc },
  'json5-json': {
    text: '{\n  "a": "x",\n  "n": null,\n  "h": 31\n}\n',
    asked:
      'Converting to JSON removes 1 comment and changes 1 value to null. Convert anyway?\n' +
      '/n: NaN → null',
  },
  'json5-jsonc': {
    text: '{\n  "a": "x", // c\n  "n": null,\n  "h": 31,\n}\n',
    asked: 'Converting to JSONC changes 1 value to null. Convert anyway?\n/n: NaN → null',
  },
};

async function open(hooks: TestHooks, name: string, bytes: string, custom: boolean) {
  const uri = await writeToCase('convert', name, bytes);
  const document = custom ? await openCustom(hooks, uri) : await openText(uri);
  if (custom) await waitFor(`the ${name} badge`, () => hooks.formatBadge().uri === uri.toString());
  return { uri, document };
}

describe('convert commands on the virtual scheme (spec 013 criterion 7)', () => {
  it('Convert to JSON, JSONC and JSON5 write a new file beside the document, asking before losses', async () => {
    const hooks = await activateHooks();
    const titles = Object.fromEntries(manifest().contributes.commands.map((c) => [c.command, c]));
    for (const to of FORMATS) equal(titles[COMMANDS[to]]?.title, `Convert to ${LABELS[to]}`, to);
    try {
      for (const custom of [false, true]) {
        for (const bom of [false, true]) {
          for (const from of FORMATS) {
            for (const to of FORMATS.filter((f) => f !== from)) {
              const label = `${from} → ${to} (${custom ? 'CHR JSON Editor' : 'text editor'}${bom ? ', BOM' : ''})`;
              const bytes = (bom ? BOM : '') + SOURCES[from];
              console.log(`convert: ${label}`);
              const { uri, document } = await open(hooks, `data.${from}`, bytes, custom);
              equal(document.getText(), SOURCES[from], `${label}: document text`);
              const key = custom
                ? 'chrJsonEditor.customEditorFormat'
                : 'chrJsonEditor.textEditorFormat';
              await waitFor(`${label}: context key`, () => {
                return hooks.convert(undefined).context[key] === from;
              });
              const target = vscode.Uri.joinPath(dirname(uri), `data.${to}`);
              const { text, asked } = RESULTS[`${from}-${to}`]!;
              if (asked) {
                hooks.confirm(false);
                await vscode.commands.executeCommand(COMMANDS[to]);
                deepEqual(hooks.confirm(undefined), [asked], `${label}: question`);
                equal(await exists(target), false, `${label}: Cancel wrote the target`);
                equal(await readText(uri), bytes, `${label}: Cancel changed the file`);
                hooks.confirm(true);
              } else {
                hooks.confirm(() => {
                  throw new Error(`${label}: asked with no losses`);
                });
              }
              await vscode.commands.executeCommand(COMMANDS[to]);
              deepEqual(hooks.confirm(undefined), asked ? [asked] : [], `${label}: question`);
              await waitFor(`${label}: the new file`, () => exists(target));
              equal(await readText(target), (bom ? BOM : '') + text, `${label}: bytes`);
              equal(await readText(uri), bytes, `${label}: the source changed`);
              equal(document.isDirty, false, `${label}: the source document changed`);
              await expectOnly(target, custom ? 'custom' : 'text');
              deepEqual(hooks.convert(undefined).messages, [], `${label}: messages`);
              await closeAll();
            }
          }
        }
      }

      // When the file beside exists, a save dialog prefilled with it picks the target.
      {
        const { uri, document } = await open(hooks, 'data.json5', SOURCES.json5, false);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(dirname(uri), 'data.json'),
          new TextEncoder().encode('{}\n'),
        );
        const other = vscode.Uri.joinPath(dirname(uri), 'other.json');
        hooks.confirm(true);
        hooks.convert(() => other.toString());
        await vscode.commands.executeCommand(COMMANDS.json);
        const seen = hooks.convert(undefined);
        hooks.confirm(undefined);
        deepEqual(
          seen.saveAs,
          [vscode.Uri.joinPath(dirname(uri), 'data.json').toString()],
          'prefilled',
        );
        equal(await readText(other), RESULTS['json5-json']!.text, 'other.json');
        equal(document.isDirty, false, 'source dirty');
        await expectOnly(other, 'text');
        await closeAll();
      }

      // A broken document is not converted; the document's own format: nothing to do.
      {
        const { uri } = await open(hooks, 'broken.jsonc', '{\n  "a": }\n', false);
        await vscode.commands.executeCommand(COMMANDS.json5);
        deepEqual(
          hooks.convert(undefined).messages,
          [
            "CHR JSON Editor: can't convert to JSON5: the document is not valid JSONC (error at " +
              'line 2, column 8). Fix it or run "Repair JSON" first.',
          ],
          'broken: message',
        );
        deepEqual(await list(dirname(uri)), ['broken.jsonc'], 'broken: files');
        await closeAll();
        const same = await open(hooks, 'same.json5', SOURCES.json5, false);
        await vscode.commands.executeCommand(COMMANDS.json5);
        deepEqual(
          hooks.convert(undefined).messages,
          ['CHR JSON Editor: the document is already JSON5.'],
          'same format: message',
        );
        deepEqual(await list(dirname(same.uri)), ['same.json5'], 'same format: files');
        await closeAll();
      }
    } finally {
      hooks.confirm(undefined);
      hooks.convert(undefined);
    }
  });

  // Spec 012 criterion 9 (012 T5), as test/e2e/jsonLines.cjs checks it on desktop.
  it('Convert to JSON Lines writes one item per line, and JSON Lines converts back', async () => {
    const hooks = await activateHooks();
    const titles = Object.fromEntries(manifest().contributes.commands.map((c) => [c.command, c]));
    equal(titles['chrJsonEditor.convertToJsonl']?.title, 'Convert to JSON Lines', 'title');
    try {
      for (const custom of [false, true]) {
        const where = custom ? 'CHR JSON Editor' : 'text editor';
        const { uri, document } = await open(
          hooks,
          'data.json',
          '[\n  {"a": 1},\n  2\n]\n',
          custom,
        );
        const key = custom ? 'chrJsonEditor.customEditorFormat' : 'chrJsonEditor.textEditorFormat';
        await waitFor(`json (${where}): context key`, () => {
          return hooks.convert(undefined).context[key] === 'json';
        });
        hooks.confirm(() => {
          throw new Error(`json → jsonl (${where}): asked with no losses`);
        });
        await vscode.commands.executeCommand('chrJsonEditor.convertToJsonl');
        deepEqual(hooks.confirm(undefined), [], `json → jsonl (${where}): question`);
        const lines = vscode.Uri.joinPath(dirname(uri), 'data.jsonl');
        await waitFor(`json → jsonl (${where}): the new file`, () => exists(lines));
        equal(await readText(lines), '{"a":1}\n2\n', `json → jsonl (${where}): bytes`);
        equal(document.isDirty, false, `json → jsonl (${where}): source dirty`);
        await expectOnly(lines, custom ? 'custom' : 'text');
        await closeAll();
        // Back from JSON Lines, in the same kind of editor.
        const back = await open(hooks, 'data.jsonl', '{"a":1}\n2\n', custom);
        await waitFor(`jsonl (${where}): context key`, () => {
          return hooks.convert(undefined).context[key] === 'jsonl';
        });
        await vscode.commands.executeCommand(COMMANDS.json5);
        const json5 = vscode.Uri.joinPath(dirname(back.uri), 'data.json5');
        await waitFor(`jsonl → json5 (${where}): the new file`, () => exists(json5));
        equal(await readText(json5), '[\n  {"a":1},\n  2\n]\n', `jsonl → json5 (${where}): bytes`);
        await expectOnly(json5, custom ? 'custom' : 'text');
        deepEqual(hooks.convert(undefined).messages, [], `${where}: messages`);
        await closeAll();
      }
      // A root that is not an array is not converted to JSON Lines.
      const { uri } = await open(hooks, 'object.json', '{"a": 1}\n', false);
      await vscode.commands.executeCommand('chrJsonEditor.convertToJsonl');
      deepEqual(
        hooks.convert(undefined).messages,
        ['CHR JSON Editor: JSON Lines needs an array at the root.'],
        'not an array: message',
      );
      deepEqual(await list(dirname(uri)), ['object.json'], 'not an array: files');
      await closeAll();
    } finally {
      hooks.confirm(undefined);
      hooks.convert(undefined);
    }
  });
});
