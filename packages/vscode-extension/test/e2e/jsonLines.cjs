// Gate for 012 T5 (spec 012 criteria 6, 7, 8 and 9), run by suite.cjs inside VS Code. JSON Lines
// files (`.jsonl`, `.ndjson`) open in the CHR JSON Editor in Table mode with Table and Tree only;
// edits through the webview write the golden bytes, save and undo as VS Code's; a bad line makes
// the tab read-only under a banner whose "Open as Text" puts the cursor on that line and whose
// "Repair Lines" is one undoable edit; and the convert commands go both ways. Each case works on a
// copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
const REPAIR_COMMAND = 'chrJsonEditor.repairJson';
const EXPORT_CSV_COMMAND = 'chrJsonEditor.exportCsv';
const SMART_FORMAT_COMMAND = 'chrJsonEditor.smartFormat';
const GOLDEN = path.resolve(__dirname, '../../../../tests/golden/jsonl');
const EXTENSIONS = ['jsonl', 'ndjson'];
const FORMATS = ['json', 'jsonc', 'json5'];
const COMMANDS = {
  json: 'chrJsonEditor.convertToJson',
  jsonc: 'chrJsonEditor.convertToJsonc',
  json5: 'chrJsonEditor.convertToJson5',
  jsonl: 'chrJsonEditor.convertToJsonl',
};
/** VS Code keeps a leading BOM out of the document's text. */
const withoutBom = (text) => text.replace(/^\uFEFF/, '');
/** Criterion 7's count of golden cases. */
const GOLDEN_CASES = 10;

const LINES = '{"name":"Ada","year":1843}\n{"name":"Grace","year":1959}\n';
/** Lines 2 and 4 are bad; line 3 is blank, which is never bad. */
const BAD = '{"name":"Ada"}\n{"name":"Grace",\n\n{name:"Barbara"}\n';
const REPAIRED = '{"name":"Ada"}\n{"name":"Grace"}\n\n{"name":"Barbara"}\n';
/** Line 1 holds two values, which Repair Lines cannot make one (L10). */
const UNREPAIRABLE = '{"a":1} {"b":2}\n{"c":\n{"d":4}\n';

/** Criterion 9: one array source per format, and what "Convert to JSON Lines" writes (J2). */
const TO_LINES = {
  json: { text: '[\n  {"a": 1},\n  {"b": [2, 3]}\n]\n', lines: '{"a":1}\n{"b":[2,3]}\n' },
  jsonc: {
    text: '[\n  // first\n  {"a": 1},\n]\n',
    lines: '{"a":1}\n',
    asked: 'Converting to JSON Lines removes 1 comment. Convert anyway?',
  },
  json5: {
    text: "[{a: 'x'}, NaN]\n",
    lines: '{"a":"x"}\nnull\n',
    asked: 'Converting to JSON Lines changes 1 value to null. Convert anyway?\n/1: NaN → null',
  },
};
/** J1: `LINES`-like items as one array, the items' bytes kept. */
const FROM_LINES = {
  text: '{"a":1}\n{"b": [2, 3]}\n',
  array: '[\n  {"a":1},\n  {"b": [2, 3]}\n]\n',
};

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runJsonLines = async function runJsonLines({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-lines-'));
  const snapshot = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  /** Writes `bytes` to a new folder as `name`. */
  function write(name, bytes) {
    const file = path.join(fs.mkdtempSync(path.join(work, 'case-')), name);
    fs.writeFileSync(file, bytes);
    return { file, uri: vscode.Uri.file(file) };
  }

  /** Polls the webview of `uri` until `predicate(probe)` holds; returns that probe. */
  async function probeUntil(uri, what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Opens `uri` with "Open With… → CHR JSON Editor" and waits for the editor to render. */
  async function openCustom(uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await rendered(uri);
    return document;
  }

  async function rendered(uri) {
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${path.basename(uri.fsPath)} webview`, () => snapshot(uri)?.scriptLoaded);
    await waitFor(`the ${path.basename(uri.fsPath)} badge`, () => {
      return hooks.formatBadge().uri === uri.toString();
    });
    return probeUntil(uri, 'the document in the editor', (p) => p.mode !== null);
  }

  async function openText(uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await expectOnly(uri, 'text', isText);
    return document;
  }

  const dom = (uri, steps) => hooks.dom(uri.toString(), steps);
  const BANNER = '[role="region"][aria-label="Bad lines"]';

  try {
    // Criterion 6: the manifest offers the editor and its commands for both extensions.
    const manifest = vscode.extensions.getExtension('christian-vrl.chr-json-editor').packageJSON;
    const selector = manifest.contributes.customEditors[0].selector.map((s) => s.filenamePattern);
    for (const ext of EXTENSIONS) assert.ok(selector.includes(`*.${ext}`), `selector *.${ext}`);
    const entries = (command) =>
      Object.entries(manifest.contributes.menus).flatMap(([menu, items]) =>
        items.filter((m) => m.command === command).map((m) => ({ menu, when: m.when })),
      );
    const opens = entries(OPEN_COMMAND);
    assert.deepEqual(opens.map((e) => e.menu).sort(), [
      'commandPalette',
      'editor/title',
      'explorer/context',
    ]);
    for (const { menu, when } of opens) {
      const extname = /resourceExtname =~ \/(.*?)\/ /.exec(when);
      assert.ok(extname, `${menu}: ${when}`);
      for (const ext of EXTENSIONS) {
        assert.match(`.${ext}`, new RegExp(extname[1]), `${menu}: .${ext}`);
      }
    }
    // "Export to CSV…" is offered in every CHR JSON Editor tab; "Repair JSON" only in a JSON,
    // JSONC or JSON5 text editor, never for JSON Lines.
    const [exportCsv] = entries(EXPORT_CSV_COMMAND).filter((e) => e.menu === 'commandPalette');
    assert.match(exportCsv.when, /^activeCustomEditorId == chrJsonEditor\.editor \|\|/);
    const [repair] = entries(REPAIR_COMMAND);
    const langs = new RegExp(/editorLangId =~ \/(.*?)\//.exec(repair.when)[1]);
    assert.doesNotMatch('jsonl', langs);

    // Smart Format (spec 010) is not offered for JSON Lines in either editor.
    const [smart] = entries(SMART_FORMAT_COMMAND).filter((e) => e.menu === 'commandPalette');
    assert.match(smart.when, /chrJsonEditor\.customEditorFormat != jsonl\b/);
    const smartLangs = new RegExp(/textEditorFormat =~ \/(.*?)\//.exec(smart.when)[1]);
    assert.doesNotMatch('jsonl', smartLangs);

    for (const ext of EXTENSIONS) {
      // "Open in CHR JSON Editor" from the text editor (palette: no URI; explorer: a URI) and
      // "Open With…": the tab opens in Table mode, with Table and Tree only.
      const { uri } = write(`data.${ext}`, LINES);
      const document = await openText(uri);
      assert.equal(document.languageId, 'jsonl', `.${ext}: VS Code's JSON Lines language`);
      await vscode.commands.executeCommand(OPEN_COMMAND);
      let probe = await rendered(uri);
      assert.equal(probe.mode, 'table', `.${ext}: opens in Table mode`);
      assert.equal(probe.toolbarMode, 'Table');
      assert.match(probe.shownText, /Grace/);
      assert.equal(probe.format, 'JSON Lines');
      await closeAll();
      await vscode.commands.executeCommand(OPEN_COMMAND, uri);
      probe = await rendered(uri);
      assert.equal(probe.mode, 'table', `.${ext}: explorer entry opens in Table mode`);
      await closeAll();
      await openCustom(uri);
      probe = await hooks.probe(uri.toString());
      assert.equal(probe.mode, 'table', `.${ext}: Open With opens in Table mode`);

      const [modes] = await dom(uri, [{ readAll: '[role="group"][aria-label="Mode"] button' }]);
      assert.deepEqual(JSON.parse(modes), ['Table', 'Tree'], `.${ext}: modes offered`);
      // Sort, transform and search are offered; format and compact (and so no text mode) are not.
      await dom(uri, [
        { waitFor: '.jse-table-mode .jse-menu .jse-sort' },
        { waitFor: '.jse-table-mode .jse-menu .jse-transform' },
        { waitFor: '.jse-table-mode .jse-menu .jse-search' },
        { waitFor: '.jse-format', gone: true },
        { waitFor: '.jse-compact', gone: true },
        { waitFor: '.chr-smart-format', gone: true },
      ]);
      // Copy is offered: the context menu of a selected row lists it, enabled.
      assert.equal(hooks.select(uri.toString(), '/0'), true);
      const [copyDisabled] = await dom(uri, [
        { click: '.jse-table-mode .jse-menu button.jse-contextmenu' },
        { read: '.jse-contextmenu button', text: 'Copy', attr: 'disabled' },
      ]);
      assert.equal(copyDisabled, null, `.${ext}: Copy is disabled`);
      await dom(uri, [{ key: 'Escape', on: '.jse-contextmenu' }]);
      // Run anyway, Smart Format leaves the document as it is.
      hooks.smartFormatMessages();
      const unformatted = document.version;
      await vscode.commands.executeCommand(SMART_FORMAT_COMMAND);
      assert.deepEqual(hooks.smartFormatMessages(), [], `.${ext}: Smart Format messages`);
      assert.equal(document.version, unformatted, `.${ext}: Smart Format edited the document`);
      assert.equal(hooks.setMode(uri.toString(), 'text'), true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal((await hooks.probe(uri.toString())).mode, 'table', `.${ext}: no text mode`);
      assert.equal(hooks.setMode(uri.toString(), 'tree'), true);
      await probeUntil(uri, 'tree mode', (p) => p.mode === 'tree' && /Grace/.test(p.shownText));
      await dom(uri, [{ waitFor: '.jse-tree-mode .jse-menu .jse-sort' }]);

      // The badge reads "JSON Lines"; the picker lists it, and choosing a format re-parses
      // without changing the bytes (003 criterion 8).
      const badge = () => hooks.formatBadge();
      assert.equal(badge().text, 'JSON Lines', `.${ext}: badge`);
      assert.equal(badge().state.detected, 'jsonl');
      const version = document.version;
      await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json');
      await waitFor(`.${ext} as JSON`, () => badge().state.format === 'json');
      assert.equal(badge().text, '$(error) JSON', `.${ext}: two lines are not one JSON value`);
      await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'jsonl');
      await waitFor(`.${ext} as JSON Lines`, () => badge().text === 'JSON Lines');
      assert.equal(document.getText(), LINES, `.${ext}: bytes changed`);
      assert.equal(document.version, version, `.${ext}: the document was edited`);
      assert.equal(document.isDirty, false);
      await closeAll();
    }
    // A .json file chosen as JSON Lines in the picker reads as JSON Lines too.
    {
      const { uri } = write('lines.json', LINES);
      const document = await openCustom(uri);
      await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'jsonl');
      await waitFor('lines.json as JSON Lines', () => hooks.formatBadge().text === 'JSON Lines');
      await probeUntil(uri, 'the items', (p) => p.format === 'JSON Lines' && p.mode === 'tree');
      assert.match((await hooks.probe(uri.toString())).shownText, /2\s+items/);
      assert.equal(document.getText(), LINES);
      await closeAll();
    }
    console.log('JSON Lines: .jsonl and .ndjson open in Table mode, Table and Tree only');

    // Criterion 7: the first 10 golden patch cases in sorted path order, through the webview (the
    // test hook hands the patch text to the editor UI, which reads big numbers exactly: spec 015).
    // VS Code keeps a leading BOM out of the document's text and writes it back on save.
    const names = fs
      .readdirSync(GOLDEN)
      .sort()
      .filter((name) =>
        ['patch.json', 'expected.jsonl'].every((f) => fs.existsSync(path.join(GOLDEN, name, f))),
      )
      .slice(0, GOLDEN_CASES);
    assert.equal(names.length, GOLDEN_CASES, 'not enough golden cases');
    for (const name of names) {
      const dir = path.join(GOLDEN, name);
      const input = fs.readFileSync(path.join(dir, 'input.jsonl'), 'utf8');
      const expected = fs.readFileSync(path.join(dir, 'expected.jsonl'), 'utf8');
      const patch = fs.readFileSync(path.join(dir, 'patch.json'), 'utf8');
      const { file, uri } = write('input.jsonl', input);
      const document = await openCustom(uri);
      assert.equal(document.getText(), withoutBom(input), `${name}: opened text`);
      const before = document.version;
      assert.equal(hooks.patch(uri.toString(), patch), true);
      await waitFor(`${name} to be edited`, () => document.version > before);
      assert.equal(document.getText(), withoutBom(expected), `${name}: document text`);
      await waitFor(`${name} to be dirty`, () => document.isDirty);
      assert.equal(snapshot(uri).editsReceived, 1, `${name}: edits sent`);
      await hooks.whenSettled(uri.toString());
      await vscode.commands.executeCommand('workbench.action.files.save');
      await waitFor(`${name} to be saved`, () => !document.isDirty);
      assert.equal(fs.readFileSync(file, 'utf8'), expected, `${name}: saved bytes`);
      await vscode.commands.executeCommand('undo');
      await waitFor(`${name}: the undo`, () => document.getText() === withoutBom(input));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(document.getText(), withoutBom(input), `${name}: one undo`);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await waitFor(`${name}: revert`, () => !document.isDirty);
      await closeAll();
    }
    console.log(`criterion 7: ${GOLDEN_CASES} JSON Lines golden cases applied, saved and undone`);

    // Criterion 7: an external WorkspaceEdit reaches the webview's data and is not echoed back;
    // sort of the root array moves whole lines, each line's bytes kept.
    {
      const text = '{"n": 3, "s": "c"}\n{"n":1,"s":"a"}\n\n{ "n" : 2 , "s":"b"}\n';
      const { uri } = write('sort.jsonl', text);
      const document = await openCustom(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, document.positionAt(text.length), '{"n":4,"s":"external"}\n');
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await probeUntil(uri, 'the external edit', (p) => /external/.test(p.shownText));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(snapshot(uri).editsReceived, 0, 'an external edit was echoed back');
      const external = document.getText();
      // A click on the table's column header sorts the root array by that column.
      await dom(uri, [{ click: '.jse-table-mode button.jse-column-header', text: 'n' }]);
      await waitFor('the sort', () => document.getText() !== external);
      assert.equal(
        document.getText(),
        '{"n":1,"s":"a"}\n{ "n" : 2 , "s":"b"}\n\n{"n": 3, "s": "c"}\n{"n":4,"s":"external"}\n',
        'sort moves whole lines; the blank line keeps its place',
      );
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    }
    console.log('criterion 7: external edits reach the webview; sort moves whole lines');

    // Criterion 8: a bad line makes the tab read-only under the banner.
    {
      const { uri } = write('bad.jsonl', BAD);
      const document = await openCustom(uri);
      const [shown] = await dom(uri, [{ read: `${BANNER} span` }]);
      assert.equal(shown.trim(), 'Line 2 is not valid JSON (2 bad lines).');
      const [buttons] = await dom(uri, [{ readAll: `${BANNER} button` }]);
      assert.deepEqual(JSON.parse(buttons), ['Open as Text', 'Repair Lines']);
      assert.match((await hooks.probe(uri.toString())).shownText, /Ada/);
      assert.equal(hooks.patch(uri.toString(), [{ op: 'remove', path: '/0' }]), true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(snapshot(uri).editsReceived, 0, 'a read-only tab sent an edit');
      assert.equal(document.getText(), BAD);

      // "Open as Text": VS Code's text editor on the same document, cursor at the start of line 2.
      await dom(uri, [{ click: `${BANNER} button`, text: 'Open as Text' }]);
      await expectOnly(uri, 'text', isText);
      const editor = () => vscode.window.activeTextEditor;
      await waitFor('the cursor on the first bad line', () => {
        const at = editor()?.selection.active;
        return editor()?.document === document && at?.line === 1 && at.character === 0;
      });
      assert.equal(editor().selection.isEmpty, true);
      assert.equal(document.isDirty, false);

      // "Repair Lines": one edit, undone by one undo; the banner goes and the tab edits again.
      await vscode.commands.executeCommand(OPEN_COMMAND);
      await rendered(uri);
      await dom(uri, [{ click: `${BANNER} button`, text: 'Repair Lines' }]);
      await waitFor('the repair', () => document.getText() === REPAIRED);
      await dom(uri, [{ waitFor: BANNER, gone: true }]);
      await vscode.commands.executeCommand('undo');
      await waitFor('the undo of the repair', () => document.getText() === BAD);
      await dom(uri, [
        { waitFor: `${BANNER} span`, text: 'Line 2 is not valid JSON (2 bad lines).' },
      ]);
      await vscode.commands.executeCommand('redo');
      await waitFor('the redo of the repair', () => document.getText() === REPAIRED);
      await dom(uri, [{ waitFor: BANNER, gone: true }]);
      const before = document.version;
      assert.equal(hooks.patch(uri.toString(), [{ op: 'remove', path: '/0' }]), true);
      await waitFor('an edit after the repair', () => document.version > before);
      assert.equal(document.getText(), '{"name":"Grace"}\n\n{"name":"Barbara"}\n');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    }
    // A line Repair Lines cannot repair is named and stays bad.
    {
      const { uri } = write('unrepairable.jsonl', UNREPAIRABLE);
      const document = await openCustom(uri);
      await dom(uri, [{ click: `${BANNER} button`, text: 'Repair Lines' }]);
      await waitFor('the repair', () => document.getText() !== UNREPAIRABLE);
      assert.equal(document.getText(), '{"a":1} {"b":2}\n{"c":null}\n{"d":4}\n');
      await dom(uri, [
        { waitFor: '.notice', text: 'Repair Lines could not repair line 1.' },
        { waitFor: `${BANNER} span`, text: 'Line 1 is not valid JSON (1 bad line).' },
      ]);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    }
    // An edit made elsewhere that leaves no bad line: the banner goes, the tab edits again.
    {
      const { uri } = write('fixed.ndjson', BAD);
      const document = await openCustom(uri);
      await dom(uri, [{ waitFor: BANNER }]);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        uri,
        new vscode.Range(document.positionAt(0), document.positionAt(BAD.length)),
        LINES,
      );
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await dom(uri, [{ waitFor: BANNER, gone: true }]);
      await probeUntil(uri, 'the fixed items', (p) => /Grace/.test(p.shownText));
      const before = document.version;
      assert.equal(
        hooks.patch(uri.toString(), [{ op: 'replace', path: '/1/year', value: 1960 }]),
        true,
      );
      await waitFor('an edit after the fix', () => document.version > before);
      assert.equal(document.getText(), LINES.replace('1959', '1960'));
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    }
    console.log('criterion 8: bad lines are read-only; Open as Text and Repair Lines work');

    // Criterion 9: the convert commands, from the palette (no URI) in both editors.
    const titles = Object.fromEntries(manifest.contributes.commands.map((c) => [c.command, c]));
    assert.equal(titles[COMMANDS.jsonl]?.title, 'Convert to JSON Lines');
    for (const menu of ['commandPalette', 'editor/title']) {
      const entry = manifest.contributes.menus[menu].find((m) => m.command === COMMANDS.jsonl);
      assert.ok(entry, `${COMMANDS.jsonl} is not in the ${menu} menu`);
      assert.match(entry.when, /chrJsonEditor\.customEditorFormat != jsonl\b/);
      assert.match(entry.when, /textEditorFormat =~ \/\^\(json\|jsonc\|json5\)\$\//);
      for (const to of FORMATS) {
        const other = manifest.contributes.menus[menu].find((m) => m.command === COMMANDS[to]);
        assert.match(other.when.split('||')[1], /[(|]jsonl[|)]/, `${COMMANDS[to]} on JSON Lines`);
      }
    }
    const key = (custom) =>
      custom ? 'chrJsonEditor.customEditorFormat' : 'chrJsonEditor.textEditorFormat';
    for (const custom of [false, true]) {
      const where = custom ? 'CHR JSON Editor' : 'text editor';
      for (const from of FORMATS) {
        const { text, lines, asked } = TO_LINES[from];
        const { file, uri } = write(`data.${from}`, text);
        const document = custom ? await openCustom(uri) : await openText(uri);
        await waitFor(`${from} (${where}): context key`, () => {
          return hooks.convert(undefined).context[key(custom)] === from;
        });
        hooks.confirm(
          asked
            ? true
            : () => {
                throw new Error(`${from} → jsonl: asked with no losses`);
              },
        );
        await vscode.commands.executeCommand(COMMANDS.jsonl);
        assert.deepEqual(hooks.confirm(undefined), asked ? [asked] : [], `${from}: question`);
        const target = path.join(path.dirname(file), 'data.jsonl');
        await waitFor(`${from} → jsonl (${where}): the new file`, () => fs.existsSync(target));
        assert.equal(fs.readFileSync(target, 'utf8'), lines, `${from} → jsonl: bytes`);
        assert.equal(fs.readFileSync(file, 'utf8'), text);
        assert.equal(document.isDirty, false);
        const shown = vscode.Uri.file(target);
        await expectOnly(shown, custom ? 'custom' : 'text', custom ? isCustom : isText);
        assert.deepEqual(hooks.convert(undefined).messages, [], `${from} → jsonl: messages`);
        await closeAll();
      }
      for (const ext of EXTENSIONS) {
        for (const to of FORMATS) {
          const { file, uri } = write(`data.${ext}`, FROM_LINES.text);
          const document = custom ? await openCustom(uri) : await openText(uri);
          await waitFor(`${ext} (${where}): context key`, () => {
            return hooks.convert(undefined).context[key(custom)] === 'jsonl';
          });
          hooks.confirm(() => {
            throw new Error(`jsonl → ${to}: asked with no losses`);
          });
          await vscode.commands.executeCommand(COMMANDS[to]);
          assert.deepEqual(hooks.confirm(undefined), []);
          const target = path.join(path.dirname(file), `data.${to}`);
          await waitFor(`${ext} → ${to} (${where}): the new file`, () => fs.existsSync(target));
          assert.equal(fs.readFileSync(target, 'utf8'), FROM_LINES.array, `${ext} → ${to}`);
          assert.equal(fs.readFileSync(file, 'utf8'), FROM_LINES.text);
          assert.equal(document.isDirty, false);
          const shown = vscode.Uri.file(target);
          await expectOnly(shown, custom ? 'custom' : 'text', custom ? isCustom : isText);
          assert.deepEqual(hooks.convert(undefined).messages, []);
          await closeAll();
        }
      }
      // The document's own format: nothing to do.
      {
        const { file, uri } = write('same.jsonl', LINES);
        if (custom) await openCustom(uri);
        else await openText(uri);
        await vscode.commands.executeCommand(COMMANDS.jsonl);
        assert.deepEqual(hooks.convert(undefined).messages, [
          'CHR JSON Editor: the document is already JSON Lines.',
        ]);
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['same.jsonl']);
        await closeAll();
      }
      // A root that is not an array is not converted to JSON Lines.
      {
        const { file, uri } = write('object.json', '{"a": [1, 2]}\n');
        if (custom) await openCustom(uri);
        else await openText(uri);
        await vscode.commands.executeCommand(COMMANDS.jsonl);
        assert.deepEqual(hooks.convert(undefined).messages, [
          'CHR JSON Editor: JSON Lines needs an array at the root.',
        ]);
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['object.json']);
        await closeAll();
      }
      // A bad line: not converted, and the message names "Repair Lines".
      {
        const { file, uri } = write('bad.jsonl', BAD);
        if (custom) await openCustom(uri);
        else await openText(uri);
        await vscode.commands.executeCommand(COMMANDS.json);
        assert.deepEqual(hooks.convert(undefined).messages, [
          "CHR JSON Editor: can't convert to JSON: the document is not valid JSON Lines (error " +
            'at line 2, column 1). Fix it or run "Repair Lines" first.',
        ]);
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['bad.jsonl']);
        await closeAll();
      }
      console.log(`criterion 9: convert to and from JSON Lines in the ${where}`);
    }
    // From the editor title menu of a tab that is not the active one: the menu's document.
    {
      const first = write('first.json', TO_LINES.json.text);
      await openCustom(first.uri);
      const second = write('second.jsonl', LINES);
      await vscode.commands.executeCommand('vscode.openWith', second.uri, VIEW_TYPE, {
        viewColumn: vscode.ViewColumn.Beside,
      });
      await waitFor('second.jsonl', () => hooks.formatBadge().uri === second.uri.toString());
      await vscode.commands.executeCommand(COMMANDS.jsonl, first.uri);
      const target = path.join(path.dirname(first.file), 'first.jsonl');
      await waitFor('first.jsonl', () => fs.existsSync(target));
      assert.equal(fs.readFileSync(target, 'utf8'), TO_LINES.json.lines);
      assert.deepEqual(hooks.convert(undefined).messages, []);
      await closeAll();
    }
    console.log('criterion 9: the title menu of another group converts its own document');
  } finally {
    hooks.confirm(undefined);
    hooks.convert(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
