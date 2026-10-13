// Gate for 003 T8 (spec 003 criteria 4, 5 and 10), run by suite.cjs inside VS Code. The library's
// own buttons and dialogs are driven through the `dom` test hook, as a person would click them, and
// the document's bytes are checked after each action:
// - criterion 4: tree → text → table → tree leaves the document unchanged;
// - criterion 5: format, compact, sort keys, search/replace, repair and transform with JSONQuery,
//   JMESPath and JSONPath turn tests/e2e/fixtures/<feature>/input.json into expected.json;
// - criterion 10: format, compact, sort and transform on tests/e2e/fixtures/comments/* keep every
//   comment not attached to a removed member;
// and the "Repair JSON" command for the text editor, which asks before removing a comment it
// cannot keep (UNK-018). Each case works on a copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const REPAIR_COMMAND = 'chrJsonEditor.repairJson';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures');

/** The steps that run each criterion 5 feature in the library's UI, and the mode they run in. */
const FEATURES = {
  format: { mode: 'text', steps: [{ click: '.jse-text-mode .jse-format' }] },
  compact: { mode: 'text', steps: [{ click: '.jse-text-mode .jse-compact' }] },
  sort: { mode: 'tree', steps: sortSteps('tree') },
  'search-replace': {
    mode: 'tree',
    steps: [
      { click: '.jse-tree-mode .jse-search' },
      { click: '.jse-replace-toggle' },
      { fill: '.jse-search-input', value: 'draft' },
      { fill: '.jse-replace-input', value: 'final' },
      { waitFor: '.jse-search-count.jse-visible' },
      { click: 'button[title="Replace all occurrences"]' },
    ],
  },
  // Repair on open: tree mode shows jsonrepair's reading of the broken file; "Ok" accepts it.
  repair: { mode: 'tree', steps: [{ click: '.jse-tree-mode button', text: 'Ok' }] },
  'transform-jsonquery': { mode: 'tree', steps: transformSteps('tree', 'filter(.age > 30)') },
  'transform-jmespath': {
    mode: 'tree',
    steps: transformSteps('tree', '[?age > `30`]', 'JMESPath'),
  },
  'transform-jsonpath': {
    mode: 'tree',
    steps: transformSteps('tree', '$[?(@.age > 30)]', 'JSONPath (Goessner)'),
  },
};

function sortSteps(mode) {
  return [
    { click: `.jse-${mode}-mode .jse-sort` },
    { click: '.jse-modal button.jse-primary', text: 'Sort' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

function transformSteps(mode, query, language) {
  return [
    { click: `.jse-${mode}-mode .jse-transform` },
    ...(language
      ? [{ click: '.jse-modal .jse-config' }, { click: '.jse-query-language', text: language }]
      : []),
    { fill: '.jse-modal textarea.jse-query', value: query },
    { click: '.jse-modal button.jse-primary', text: 'Transform' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

/** The comments of a document, each as its text between the markers (`// x` and `/* x *\/` alike,
 *  since compact writes line comments as block comments). The fixtures hold no `//` or `/*` in
 *  strings. */
function commentsOf(text) {
  return [...text.matchAll(/\/\/([^\n]*)|\/\*([\s\S]*?)\*\//g)].map((m) => (m[1] ?? m[2]).trim());
}

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runActions = async function runActions({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-actions-'));

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

  /** Opens a copy of `source` in the custom editor, in `mode`, once the editor holds it. */
  async function open(source, mode = 'tree') {
    const target = path.join(fs.mkdtempSync(path.join(work, 'case-')), path.basename(source));
    fs.copyFileSync(source, target);
    const uri = vscode.Uri.file(target);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const view = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the webview of ${path.basename(source)}`, () => view()?.scriptLoaded === true);
    await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
    if (mode !== 'tree') {
      assert.equal(hooks.setMode(uri.toString(), mode), true);
      await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
    }
    return { uri, document, view };
  }

  /** Runs `steps` in the editor of `uri` and waits for the document to change from `before`. */
  async function act(uri, document, steps, what) {
    const before = document.getText();
    const reads = await hooks.dom(uri.toString(), steps);
    await waitFor(`${what} to change the document`, () => document.getText() !== before);
    // Let the editor take the host's answer, so the next step starts from the written text.
    await probeUntil(uri, `${what} to show`, (p) => p.notice === '' && !!p.content);
    return reads;
  }

  async function finish(uri, document) {
    const probe = await hooks.probe(uri.toString());
    assert.deepEqual(probe.violations, [], 'the action broke the CSP');
    await document.save();
    await closeAll();
  }

  try {
    // Criterion 4: mode switches never write to the document.
    for (const name of ['sample.json', 'sample.jsonc', 'sample.json5']) {
      const source = path.join(FIXTURES, 'open', name);
      const { uri, document, view } = await open(source);
      const bytes = fs.readFileSync(source, 'utf8');
      for (const mode of ['text', 'table', 'tree']) {
        assert.equal(hooks.setMode(uri.toString(), mode), true);
        await probeUntil(uri, `${mode} mode`, (p) => p.mode === mode);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(document.getText(), bytes, `${name}: switching modes changed the document`);
      assert.equal(document.isDirty, false, `${name}: switching modes made the document dirty`);
      assert.equal(view().editsReceived, 0, `${name}: switching modes sent an edit`);
      await closeAll();
    }
    console.log('criterion 4: tree → text → table → tree leaves every sample unchanged');

    // Criterion 5: each feature, run in the library's UI, writes expected.json byte for byte.
    for (const [feature, { mode, steps }] of Object.entries(FEATURES)) {
      const dir = path.join(FIXTURES, feature);
      const { uri, document } = await open(path.join(dir, 'input.json'), mode);
      const expected = fs.readFileSync(path.join(dir, 'expected.json'), 'utf8');
      await act(uri, document, steps, feature);
      assert.equal(document.getText(), expected, `${feature}: not expected.json`);
      await finish(uri, document);
      console.log(`criterion 5: ${feature} writes expected.json byte for byte`);
    }

    // The transform dialog lists the four native query languages (JSONPath (RFC 9535) from 014 T3)
    // and links to JSONQuery's site.
    {
      const { uri, document } = await open(path.join(FIXTURES, 'transform-jsonquery/input.json'));
      const [link, ...names] = await hooks.dom(uri.toString(), [
        { click: '.jse-tree-mode .jse-transform' },
        { read: '.jse-modal .jse-description a', attr: 'href' },
        { click: '.jse-modal .jse-config' },
        { read: '.jse-query-language', text: 'JSONQuery' },
        { read: '.jse-query-language', text: 'JMESPath' },
        { read: '.jse-query-language', text: 'JSONPath (RFC 9535)' },
        { read: '.jse-query-language', text: 'JSONPath (Goessner)' },
      ]);
      assert.match(link, /^https:\/\/jsonquerylang\.org/);
      assert.equal(names.length, 4);
      const shown = await hooks.dom(uri.toString(), [{ read: '.jse-select-query-language' }]);
      assert.doesNotMatch(shown[0], /JavaScript|Lodash/, 'JavaScript or Lodash is offered');
      await finish(uri, document);
    }

    // Criterion 10: comments survive format, compact, sort and transform, in tree and text mode;
    // only the comments of a member the transform removed go with it. The removed member's
    // comments sit on their own line and after it: which member a block comment ahead of a member on
    // the same line belongs to is still open (UNK-021).
    const commentCases = [
      { file: 'settings.jsonc', mode: 'text', steps: FEATURES.format.steps, what: 'format' },
      { file: 'settings.jsonc', mode: 'text', steps: FEATURES.compact.steps, what: 'compact' },
      { file: 'settings.jsonc', mode: 'tree', steps: sortSteps('tree'), what: 'sort (tree)' },
      { file: 'settings.jsonc', mode: 'text', steps: sortSteps('text'), what: 'sort (text)' },
      {
        file: 'settings.jsonc',
        mode: 'tree',
        steps: transformSteps('tree', 'pick(.zoom, .exclude, .age)'),
        what: 'transform removing a member',
      },
      { file: 'people.json5', mode: 'text', steps: FEATURES.format.steps, what: 'format' },
      { file: 'people.json5', mode: 'text', steps: FEATURES.compact.steps, what: 'compact' },
      {
        file: 'people.json5',
        mode: 'tree',
        steps: transformSteps('tree', 'sort(.age, "desc")'),
        what: 'transform that sorts',
      },
      {
        file: 'people.json5',
        mode: 'text',
        steps: transformSteps('text', 'filter(.age > 30)'),
        what: 'transform removing a member (text)',
        removed: ['the second one', 'young'],
      },
    ];
    for (const { file, mode, steps, what, removed = [] } of commentCases) {
      const source = path.join(FIXTURES, 'comments', file);
      const { uri, document } = await open(source, mode);
      const before = fs.readFileSync(source, 'utf8');
      if (what === 'format' && file === 'settings.jsonc') {
        // Already formatted: the action answers without a write.
        await hooks.dom(uri.toString(), steps);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        await act(uri, document, steps, `${file} ${what}`);
      }
      const kept = commentsOf(before).filter((c) => !removed.includes(c));
      assert.deepEqual(
        [...commentsOf(document.getText())].sort(),
        [...kept].sort(),
        `${file} ${what}: comments lost or added:\n${document.getText()}`,
      );
      await finish(uri, document);
      console.log(`criterion 10: ${file} ${what} keeps every comment it should`);
    }

    // "Repair JSON" in the text editor: repairs in one edit, keeping comments; asks before
    // removing a comment it cannot keep, and leaves the document alone when told no.
    {
      const target = path.join(fs.mkdtempSync(path.join(work, 'case-')), 'broken.jsonc');
      const lossy = '{\n  "a": "x" + // between\n    "y",\n  "b": 1 // kept\n}\n';
      fs.writeFileSync(target, lossy);
      const uri = vscode.Uri.file(target);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      hooks.confirm(false);
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      let asked = hooks.confirm(true);
      assert.equal(asked.length, 1, 'the lossy repair did not ask');
      assert.match(asked[0], /\/\/ between/);
      assert.equal(document.getText(), lossy, 'declining the repair changed the document');
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      asked = hooks.confirm(undefined);
      assert.equal(asked.length, 1);
      assert.equal(document.getText(), '{\n  "a": "xy",\n  "b": 1 // kept\n}\n');
      await vscode.commands.executeCommand('workbench.action.files.revert');

      // The document changes while the question is open: the repair is made again on the new
      // text, not written over it at the old offsets, and the comment already agreed to is not
      // asked about again.
      let edited = false;
      hooks.confirm(async () => {
        if (!edited) {
          edited = true;
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, new vscode.Position(0, 0), '// top\n');
          assert.equal(await vscode.workspace.applyEdit(edit), true);
        }
        return true;
      });
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      asked = hooks.confirm(undefined);
      assert.equal(asked.length, 1, 'the repair asked again about the comment already agreed to');
      assert.equal(document.getText(), '// top\n{\n  "a": "xy",\n  "b": 1 // kept\n}\n');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();

      // JSON5-only values come through Repair as they are (UNK-028); only quoting, the missing
      // comma and the trailing comma change.
      const json5 = path.join(fs.mkdtempSync(path.join(work, 'case-')), 'broken.json5');
      fs.writeFileSync(
        json5,
        '{\n  hex: 0x1F // kept\n  inf: Infinity,\n  nan: NaN,\n  plus: +1,\n  neg: -Infinity,\n' +
          "  text: 'line \\\n  continued',\n}\n",
      );
      const json5Doc = await vscode.workspace.openTextDocument(vscode.Uri.file(json5));
      await vscode.window.showTextDocument(json5Doc);
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      assert.equal(
        json5Doc.getText(),
        '{\n  "hex": 0x1F, // kept\n  "inf": Infinity,\n  "nan": NaN,\n  "plus": +1,\n' +
          '  "neg": -Infinity,\n  "text": \'line \\\n  continued\'\n}\n',
      );
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();

      const repairSource = path.join(FIXTURES, 'repair/input.json');
      const copy = path.join(fs.mkdtempSync(path.join(work, 'case-')), 'input.json');
      fs.copyFileSync(repairSource, copy);
      const broken = await vscode.workspace.openTextDocument(vscode.Uri.file(copy));
      await vscode.window.showTextDocument(broken);
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      assert.equal(
        broken.getText(),
        fs.readFileSync(path.join(FIXTURES, 'repair/expected.json'), 'utf8'),
      );
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
      console.log(
        'Repair JSON: repairs in the text editor, asks before removing a comment, follows ' +
          'edits made while asking and keeps JSON5-only values',
      );
    }
  } finally {
    hooks.confirm(undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
};
