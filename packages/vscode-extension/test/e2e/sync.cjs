// Gate for 003 T5 (spec 003 criteria 1, 2 and 10), run by suite.cjs inside VS Code. Every file is a
// copy in a temporary folder, so edits and saves never touch the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
const REPO = path.resolve(__dirname, '../../../..');
const GOLDEN = path.join(REPO, 'tests/golden');
// The `op` tags of whole-document golden cases (tests/golden/load.ts `wholeDocumentOps`).
const WHOLE_DOCUMENT_OPS = ['compact', 'sort', 'data-diff', 'format'];
const OPEN = path.join(REPO, 'tests/e2e/fixtures/open');
const FORMATS = ['json', 'jsonc', 'json5'];
const CASES_PER_FORMAT = 10;

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runSync = async function runSync({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-sync-'));
  const copy = (source, name) => {
    const target = path.join(work, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return vscode.Uri.file(target);
  };

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

  /** Opens `uri` in the custom editor and waits until the webview shows the document's text. */
  async function open(uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${path.basename(uri.fsPath)} webview`, () =>
      hooks.webviews().some((w) => w.uri === uri.toString() && w.scriptLoaded),
    );
    await probeUntil(
      uri,
      'the document in the editor',
      (p) => p.mode !== null && p.content !== null,
    );
    return document;
  }

  const snapshot = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  try {
    // Criterion 1: the first 10 golden patch cases per format, in sorted path order (whole-document
    // actions, tests/golden/load.ts `wholeDocumentOps`, hold no RFC 6902 patch). The patch goes
    // through the webview (the test hook hands its text to the editor UI, which reads it as a tree
    // edit would hold it, big numbers exactly: spec 015), the host applies it with core, and the
    // document's text must equal expected.* byte for byte.
    for (const format of FORMATS) {
      const names = fs
        .readdirSync(path.join(GOLDEN, format))
        .sort()
        .filter((name) => {
          const tags = JSON.parse(
            fs.readFileSync(path.join(GOLDEN, format, name, 'case.json'), 'utf8'),
          );
          return !WHOLE_DOCUMENT_OPS.includes(tags.op);
        })
        .slice(0, CASES_PER_FORMAT);
      assert.equal(names.length, CASES_PER_FORMAT, `${format}: not enough golden cases`);
      for (const name of names) {
        const dir = path.join(GOLDEN, format, name);
        const uri = copy(
          path.join(dir, `input.${format}`),
          `golden/${format}/${name}/input.${format}`,
        );
        const expected = fs.readFileSync(path.join(dir, `expected.${format}`), 'utf8');
        const patch = fs.readFileSync(path.join(dir, 'patch.json'), 'utf8');
        const document = await open(uri);
        const before = document.version;
        assert.equal(hooks.patch(uri.toString(), patch), true);
        await waitFor(`${format}/${name} to be edited`, () => document.version > before);
        assert.equal(document.getText(), expected, `${format}/${name}: document text`);
        // isDirty can lag the version change by a tick (seen on VS Code 1.139.1, PR #57).
        await waitFor(`${format}/${name} to be dirty`, () => document.isDirty);
        // The tree keeps the data it made, which the host's text holds too (UNK-014); text mode
        // shows the host's new text, comments included, not an echo of its own (criterion 10).
        await hooks.whenSettled(uri.toString());
        assert.equal(hooks.setMode(uri.toString(), 'text'), true);
        await probeUntil(
          uri,
          `${format}/${name} in the webview`,
          (p) => p.mode === 'text' && p.content?.text === expected,
        );
        assert.equal(snapshot(uri).editsReceived, 1, `${format}/${name}: edits sent`);
        await document.save();
        await closeAll();
      }
      console.log(
        `criterion 1: ${CASES_PER_FORMAT} ${format} golden cases applied through the webview`,
      );
    }

    // Criterion 2: an external WorkspaceEdit reaches the webview's data, and nothing comes back.
    const jsonc = copy(path.join(OPEN, 'sample.jsonc'), 'external/sample.jsonc');
    const document = await open(jsonc);
    const original = document.getText();
    await hooks.setMode(jsonc.toString(), 'tree');
    const external = new vscode.WorkspaceEdit();
    const at = original.indexOf('true');
    external.replace(
      jsonc,
      new vscode.Range(document.positionAt(at), document.positionAt(at + 4)),
      'false',
    );
    assert.equal(await vscode.workspace.applyEdit(external), true);
    const version = document.version;
    const changed = document.getText();
    await probeUntil(jsonc, 'the external edit in the webview', (p) => p.content?.text === changed);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(document.version, version, 'criterion 2: the webview edited the document back');
    assert.equal(snapshot(jsonc).editsReceived, 0, 'criterion 2: the webview sent an edit');
    console.log('criterion 2: an external edit reaches the webview and is not echoed back');

    // 003 T2 review F4: a change of formatting only (same data) still reaches the webview's text.
    const reformatted = changed.replace(/\n {2}/g, '\n    ');
    assert.notEqual(reformatted, changed);
    const reformat = new vscode.WorkspaceEdit();
    reformat.replace(
      jsonc,
      new vscode.Range(document.positionAt(0), document.positionAt(changed.length)),
      reformatted,
    );
    assert.equal(await vscode.workspace.applyEdit(reformat), true);
    await hooks.setMode(jsonc.toString(), 'text');
    const shown = await probeUntil(
      jsonc,
      'the reformatted text',
      (p) => p.mode === 'text' && p.content?.text === reformatted,
    );
    assert.match(
      shown.shownText,
      /JSONC: comments and a trailing comma/,
      'text mode shows the comments',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(snapshot(jsonc).editsReceived, 0, 'a reformat must not be echoed');
    console.log('an external change of formatting only reaches the webview text');
    await document.save();
    await closeAll();

    // Criterion 10: files with comments open in every mode with no edit and no comment lost, and a
    // tree edit keeps every comment (core's applyPatch; the golden cases above cover the rest).
    for (const format of ['jsonc', 'json5']) {
      const uri = copy(path.join(OPEN, `sample.${format}`), `comments/sample.${format}`);
      const doc = await open(uri);
      const text = doc.getText();
      const comments = text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];
      assert.ok(comments.length > 0, `sample.${format} has no comments`);
      for (const mode of ['tree', 'text', 'table', 'tree']) {
        await hooks.setMode(uri.toString(), mode);
        const probe = await probeUntil(
          uri,
          `sample.${format} in ${mode} mode`,
          (p) => p.mode === mode,
        );
        if (mode === 'tree')
          assert.match(probe.shownText, /CHR JSON Editor/, `${format} tree: data shown`);
        if (mode === 'text') {
          for (const comment of comments)
            assert.ok(probe.shownText.includes(comment.trim()), `${format} text: ${comment}`);
        }
        assert.equal(probe.content?.text, text, `${format} ${mode}: editor content`);
      }
      assert.equal(doc.getText(), text, `sample.${format}: opening changed the text`);
      assert.equal(snapshot(uri).editsReceived, 0, `sample.${format}: opening sent an edit`);
      const before = doc.version;
      hooks.patch(uri.toString(), [{ op: 'replace', path: '/name', value: 'Renamed' }]);
      await waitFor(`sample.${format} to be renamed`, () => doc.version > before);
      for (const comment of comments)
        assert.ok(doc.getText().includes(comment), `${format}: lost ${comment}`);
      assert.match(doc.getText(), /Renamed/);
      console.log(
        `criterion 10: sample.${format} keeps every comment (${comments.length}) in every mode and through an edit`,
      );
      await doc.save();
      await closeAll();
    }

    // Criterion 8 in the webview (003 T10 review): choosing a format re-parses there too, and the
    // choice is kept after the document's last tab closes.
    const formatUri = copy(path.join(OPEN, 'sample.json'), 'format/sample.json');
    const formatDoc = await open(formatUri);
    const bytes = formatDoc.getText();
    await probeUntil(formatUri, 'the JSON label', (p) => p.format === 'JSON');
    await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json5');
    await probeUntil(formatUri, 'the JSON5 label in the webview', (p) => p.format === 'JSON5');
    await closeAll();
    await open(formatUri);
    await probeUntil(formatUri, 'JSON5 kept after reopening', (p) => p.format === 'JSON5');
    assert.equal(hooks.formatBadge().state.format, 'json5');
    await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, 'json');
    await probeUntil(formatUri, 'the JSON label again', (p) => p.format === 'JSON');
    assert.equal(formatDoc.getText(), bytes, 'choosing a format changed the bytes');
    assert.equal(formatDoc.isDirty, false);
    console.log(
      'the format picker re-parses in the webview and the choice survives closing the tab',
    );
    await closeAll();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
