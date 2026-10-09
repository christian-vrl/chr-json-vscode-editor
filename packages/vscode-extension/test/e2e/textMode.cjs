// Gate for 003 T6 (spec 003 criterion 9), run by suite.cjs inside VS Code. Typing in the webview's
// text mode updates the document within one debounce interval of typing stopping, as one edit for
// the whole burst; invalid text shows an error marker and reaches the document exactly as typed,
// never as a repaired text, also after a trip through tree mode (where the library shows a
// repaired view). The file is a copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const REPO = path.resolve(__dirname, '../../../..');
const OPEN = path.join(REPO, 'tests/e2e/fixtures/open');
/** app-shell's TEXT_DEBOUNCE_MS, read from its source so the two cannot drift apart. */
const TEXT_DEBOUNCE_MS = Number(
  /TEXT_DEBOUNCE_MS = (\d+)/.exec(
    fs.readFileSync(path.join(REPO, 'packages/app-shell/src/text-mode.ts'), 'utf8'),
  )[1],
);

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runTextMode = async function runTextMode({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  assert.ok(TEXT_DEBOUNCE_MS > 0, 'TEXT_DEBOUNCE_MS not found in app-shell');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-text-'));
  const target = path.join(work, 'sample.jsonc');
  fs.copyFileSync(path.join(OPEN, 'sample.jsonc'), target);
  const uri = vscode.Uri.file(target);
  const snapshot = () => hooks.webviews().find((w) => w.uri === uri.toString());

  async function probeUntil(what, predicate, timeoutMs = 10000) {
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

  /** Types `text` in the webview and returns how long after the last keystroke the document took. */
  async function typeAndTime(document, text) {
    const expected = document.getText() + text;
    let changedAt;
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document && event.document.getText() === expected) {
        changedAt ??= Date.now();
      }
    });
    try {
      const edits = snapshot().editsReceived;
      const typedAt = await hooks.type(uri.toString(), text);
      await waitFor(`the document to hold ${JSON.stringify(text)}`, () => changedAt !== undefined);
      assert.equal(document.getText(), expected, 'the document is not the text as typed');
      assert.equal(snapshot().editsReceived, edits + 1, 'the typing was not sent as one edit');
      return changedAt - typedAt;
    } finally {
      listener.dispose();
    }
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor('the webview', () => snapshot()?.scriptLoaded === true);
    await probeUntil('the document in the editor', (p) => p.mode !== null && p.content !== null);
    assert.equal(hooks.setMode(uri.toString(), 'text'), true);
    await probeUntil('text mode', (p) => p.mode === 'text');

    // Valid text: the document follows once typing pauses, within one interval after that.
    const latency = await typeAndTime(document, ' /* typed in text mode */');
    assert.ok(
      latency >= TEXT_DEBOUNCE_MS - 5,
      `the document changed ${latency} ms after typing stopped: before the debounce interval`,
    );
    assert.ok(
      latency < 2 * TEXT_DEBOUNCE_MS,
      `the document changed ${latency} ms after typing stopped: more than one interval late`,
    );
    // VS Code reports the dirty state to the extension host after the change event, so it can lag
    // the text by a tick (seen locally: false at the change event, true 50 ms later, same version).
    await waitFor('the document to be dirty', () => document.isDirty);
    const valid = await probeUntil(
      'the typed text in the editor',
      (p) => p.content?.text === document.getText(),
    );
    assert.equal(valid.errorMessage, null, 'valid text shows an error');
    assert.equal(valid.errorMarkers, 0, 'valid text shows an error marker');
    console.log(
      `criterion 9: typing reached the document ${latency} ms after it stopped (debounce ${TEXT_DEBOUNCE_MS} ms)`,
    );

    // Invalid text: written as typed, with an error marker; never replaced by a repaired text.
    await typeAndTime(document, ' ]');
    const invalid = document.getText();
    assert.match(invalid, /text mode \*\/ \]$/);
    const shown = await probeUntil(
      'the error marker',
      (p) => p.errorMessage !== null && p.errorMarkers > 0,
    );
    assert.deepEqual(shown.violations, [], 'drawing the error marker broke the CSP');
    const edits = snapshot().editsReceived;
    for (const mode of ['tree', 'text']) {
      assert.equal(hooks.setMode(uri.toString(), mode), true);
      await probeUntil(`${mode} mode`, (p) => p.mode === mode);
    }
    await probeUntil(
      'the error marker again',
      (p) => p.errorMessage !== null && p.errorMarkers > 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 3 * TEXT_DEBOUNCE_MS));
    assert.equal(document.getText(), invalid, 'the document was overwritten');
    assert.equal(snapshot().editsReceived, edits, 'switching modes sent an edit');
    console.log(
      'criterion 9: invalid text shows an error marker and is never replaced by a repair',
    );

    await document.save();
    await closeAll();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
