// Gate for 006 T3 (spec 006 criteria 6 and 7), run by suite.cjs inside VS Code. "Convert to JSON /
// JSONC / JSON5" converts the active document in the CHR JSON Editor and in the text editor and
// writes a new file beside it with the target's extension, opened in the same kind of editor
// (UNK-035). With losses it asks first, and "Cancel" changes nothing and creates no file; a broken
// document is not converted. Each source also runs with a UTF-8 byte order mark (#60 Reviewer note
// F1): VS Code leaves it out of the document's text, and it stays the new file's encoding mark.
// Each case works in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
const FORMATS = ['json', 'jsonc', 'json5'];
const LABELS = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };
const COMMANDS = {
  json: 'chrJsonEditor.convertToJson',
  jsonc: 'chrJsonEditor.convertToJsonc',
  json5: 'chrJsonEditor.convertToJson5',
};
const BOM = '﻿';

/** One source per format, and what each conversion writes and asks (core's convert, 006 T2). */
const SOURCES = {
  json: '{\n  "a": [1, 2.5e3],\n  "b": "x"\n}\n',
  jsonc: '{\n  // keep\n  "a": 1,\n}\n',
  json5: "{\n  a: 'x', // c\n  n: NaN,\n  h: 0x1F,\n}\n",
};
const RESULTS = {
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

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runConvert = async function runConvert({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-convert-'));

  /** Writes `bytes` to a new folder as `name` and opens it in the custom or the text editor. */
  async function open(name, bytes, custom) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), name);
    fs.writeFileSync(file, bytes);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    if (custom) {
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await expectOnly(uri, 'custom', isCustom);
      await waitFor(`the ${name} badge`, () => hooks.formatBadge().uri === uri.toString());
    } else {
      await vscode.window.showTextDocument(document);
      await expectOnly(uri, 'text', isText);
    }
    return { file, uri, document };
  }

  /** Waits until `file` is shown alone, active, in the kind of editor the command ran from. */
  async function expectShown(file, custom) {
    const uri = vscode.Uri.file(file);
    await expectOnly(uri, custom ? 'custom' : 'text', custom ? isCustom : isText);
  }

  try {
    // Criterion 6: palette and editor-title entries for each command, hidden for the document's
    // own format through the context keys the extension sets.
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const titles = Object.fromEntries(manifest.contributes.commands.map((c) => [c.command, c]));
    for (const to of FORMATS) {
      assert.equal(titles[COMMANDS[to]]?.title, `Convert to ${LABELS[to]}`);
      for (const menu of ['commandPalette', 'editor/title']) {
        const entry = manifest.contributes.menus[menu].find((m) => m.command === COMMANDS[to]);
        assert.ok(entry, `${COMMANDS[to]} is not in the ${menu} menu`);
        assert.match(entry.when, new RegExp(`chrJsonEditor.customEditorFormat != ${to}\\b`));
        assert.match(entry.when, /activeEditor == workbench.editors.files.textFileEditor/);
        assert.doesNotMatch(entry.when.split('||')[1], new RegExp(`[(|]${to}[|)]`));
      }
    }

    // Criterion 6 (and F1): every pair from both editors, with and without a BOM. Losses ask
    // first; "Cancel" leaves everything as it was.
    for (const custom of [false, true]) {
      for (const bom of [false, true]) {
        for (const from of FORMATS) {
          for (const to of FORMATS.filter((f) => f !== from)) {
            const label = `${from} → ${to} (${custom ? 'CHR JSON Editor' : 'text editor'}${bom ? ', BOM' : ''})`;
            const bytes = (bom ? BOM : '') + SOURCES[from];
            const { file, document } = await open(`data.${from}`, bytes, custom);
            // F1: VS Code keeps the BOM out of the document's text; the command reads it from disk.
            assert.equal(document.getText(), SOURCES[from], `${label}: document text`);
            const key = custom
              ? 'chrJsonEditor.customEditorFormat'
              : 'chrJsonEditor.textEditorFormat';
            await waitFor(
              `${label}: context key`,
              () => hooks.convert(undefined).context[key] === from,
            );
            const target = path.join(path.dirname(file), `data.${to}`);
            const { text, asked } = RESULTS[`${from}-${to}`];
            if (asked) {
              hooks.confirm(false);
              await vscode.commands.executeCommand(COMMANDS[to]);
              assert.deepEqual(hooks.confirm(undefined), [asked], `${label}: question`);
              assert.equal(fs.existsSync(target), false, `${label}: Cancel wrote ${target}`);
              assert.equal(
                fs.readFileSync(file, 'utf8'),
                bytes,
                `${label}: Cancel changed the file`,
              );
              assert.equal(document.isDirty, false, `${label}: Cancel changed the document`);
              hooks.confirm(true);
            } else {
              hooks.confirm(() => {
                throw new Error(`${label}: asked with no losses`);
              });
            }
            await vscode.commands.executeCommand(COMMANDS[to]);
            assert.deepEqual(hooks.confirm(undefined), asked ? [asked] : [], `${label}: question`);
            await waitFor(`${label}: the new file`, () => fs.existsSync(target));
            assert.equal(
              fs.readFileSync(target, 'utf8'),
              (bom ? BOM : '') + text,
              `${label}: bytes`,
            );
            assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${label}: the source changed`);
            assert.equal(document.isDirty, false, `${label}: the source document changed`);
            await expectShown(target, custom);
            assert.deepEqual(hooks.convert(undefined).messages, [], `${label}: messages`);
            await closeAll();
          }
        }
        console.log(
          `Convert: all six pairs in the ${custom ? 'CHR JSON Editor' : 'text editor'}` +
            `${bom ? ' with a BOM' : ''}, asking before losses`,
        );
      }
    }

    // UNK-035: when the file beside exists, a save dialog prefilled with it picks the target;
    // closing the dialog writes nothing, and the source itself is refused. The badge's chosen
    // format is the source format: a .json file read as JSON5 converts to data.json, the file
    // itself.
    {
      const bytes = "{a: 'x'}\n";
      const { file, uri, document } = await open('data.json', bytes, true);
      await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json5');
      await waitFor('the JSON5 context key', () => {
        return hooks.convert(undefined).context['chrJsonEditor.customEditorFormat'] === 'json5';
      });
      hooks.convert(() => undefined);
      await vscode.commands.executeCommand(COMMANDS.json);
      let seen = hooks.convert(() => uri.toString());
      assert.deepEqual(seen.saveAs, [uri.toString()], 'save dialog prefilled with data.json');
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
      await vscode.commands.executeCommand(COMMANDS.json);
      const other = path.join(path.dirname(file), 'other.json');
      seen = hooks.convert(() => vscode.Uri.file(other).toString());
      assert.deepEqual(seen.messages, [
        'CHR JSON Editor: the converted file must not replace the file it comes from.',
      ]);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      await vscode.commands.executeCommand(COMMANDS.json);
      hooks.convert(undefined);
      assert.equal(fs.readFileSync(other, 'utf8'), '{"a": "x"}\n');
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.equal(document.isDirty, false);
      await expectShown(other, true);
      await closeAll();
      console.log('Convert: an existing target opens a prefilled save dialog');
    }

    // Criterion 7: a broken document is not converted; the message gives the error's position
    // (#60 Reviewer note F2), with and without a BOM.
    for (const bom of [false, true]) {
      const { file } = await open('broken.jsonc', `${bom ? BOM : ''}{\n  "a": }\n`, false);
      await vscode.commands.executeCommand(COMMANDS.json5);
      assert.deepEqual(hooks.convert(undefined).messages, [
        "CHR JSON Editor: can't convert to JSON5: the document is not valid JSONC (error at " +
          'line 2, column 8). Fix it or run "Repair JSON" first.',
      ]);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['broken.jsonc']);
      await closeAll();
    }

    // The document's own format: nothing to do.
    {
      const { file } = await open('same.json5', SOURCES.json5, false);
      await vscode.commands.executeCommand(COMMANDS.json5);
      assert.deepEqual(hooks.convert(undefined).messages, [
        'CHR JSON Editor: the document is already JSON5.',
      ]);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['same.json5']);
      await closeAll();
    }

    // From the title menu of an editor that is not the active one: the menu's document converts.
    {
      const first = await open('first.jsonc', SOURCES.jsonc, false);
      await open('second.json5', SOURCES.json5, false);
      hooks.confirm(true);
      await vscode.commands.executeCommand(COMMANDS.json5, first.uri);
      assert.deepEqual(hooks.confirm(undefined), []);
      const target = path.join(path.dirname(first.file), 'first.json5');
      assert.equal(fs.readFileSync(target, 'utf8'), SOURCES.jsonc);
      await expectShown(target, false);
      await closeAll();
    }

    // An edit made while the question is open: converted again from the new text, and asked again
    // only because the losses changed. The unsaved text is converted, not the file on disk.
    {
      const { file, uri, document } = await open('edit.jsonc', SOURCES.jsonc, false);
      let edits = 0;
      hooks.confirm(async () => {
        if (edits++ === 0) {
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, new vscode.Position(0, 0), '// top\n');
          assert.equal(await vscode.workspace.applyEdit(edit), true);
        }
        return true;
      });
      await vscode.commands.executeCommand(COMMANDS.json);
      assert.deepEqual(hooks.confirm(undefined), [
        'Converting to JSON removes 1 comment. Convert anyway?',
        'Converting to JSON removes 2 comments. Convert anyway?',
      ]);
      const target = path.join(path.dirname(file), 'edit.json');
      assert.equal(fs.readFileSync(target, 'utf8'), '{\n  "a": 1\n}\n');
      assert.equal(fs.readFileSync(file, 'utf8'), SOURCES.jsonc);
      assert.equal(document.getText(), `// top\n${SOURCES.jsonc}`);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
      console.log('Convert: broken and same-format documents are left alone; edits while asking');
    }
  } finally {
    hooks.confirm(undefined);
    hooks.convert(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
