// Gate for 003 T7 (spec 003 criterion 3), run by suite.cjs inside VS Code. After a webview edit the
// document is dirty; `workbench.action.files.save` writes exactly the document's text and clears
// the dirty marker; `undo` restores the previous text exactly. Undo and redo are VS Code's: the
// commands, the webview's Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and the library's menu buttons each move
// one step in the document's undo stack, never two (the library's own history is not used). Typing
// that text mode still holds back (text-mode.ts debounce) reaches the document before a save
// (the `flush` request) and before an undo; a hidden tab's save asks for no flush. The file is a
// copy in a temporary folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const OPEN = path.resolve(__dirname, '../../../../tests/e2e/fixtures/open');
/** Long enough for a second, wrong undo to have landed: one message round trip and more. */
const SETTLE_MS = 500;

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 * @param {(uri: vscode.Uri, kind: string, check: (tab: vscode.Tab) => boolean) => Promise<void>} t.expectOnly
 * @param {(tab: vscode.Tab) => boolean} t.isCustom
 */
exports.runUndoSave = async function runUndoSave({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-json-editor-undo-'));
  const target = path.join(work, 'sample.jsonc');
  fs.copyFileSync(path.join(OPEN, 'sample.jsonc'), target);
  const uri = vscode.Uri.file(target);
  const key = uri.toString();

  async function probeUntil(what, predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(key);
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const onDisk = () => fs.readFileSync(target, 'utf8');

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor('the webview', () =>
      hooks.webviews().some((w) => w.uri === key && w.scriptLoaded),
    );
    await probeUntil('the document in the editor', (p) => p.mode !== null && p.content !== null);
    const original = document.getText();
    assert.equal(document.isDirty, false);

    /** Edits through the webview as a tree edit would and returns the document's new text. */
    async function edit(value) {
      const before = document.getText();
      assert.equal(hooks.patch(key, [{ op: 'replace', path: '/offline', value }]), true);
      await waitFor(`the edit to ${JSON.stringify(value)}`, () => document.getText() !== before);
      await probeUntil('the edit in the editor', (p) => p.content?.text === document.getText());
      return document.getText();
    }

    /** Runs `step` and checks the document ends at exactly `text`, and stays there. */
    async function expectStep(what, step, text) {
      await step();
      await waitFor(`${what} to give the expected text`, () => document.getText() === text);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      assert.equal(document.getText(), text, `${what} moved more than one step`);
      await probeUntil(`${what} in the editor`, (p) => p.content?.text === text);
    }

    // A webview edit makes the document dirty; saving writes its text and clears the marker.
    const first = await edit(false);
    await waitFor('the document to be dirty', () => document.isDirty);
    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor('the save', () => !document.isDirty);
    assert.equal(onDisk(), document.getText(), 'the file on disk is not the document text');
    assert.equal(onDisk(), first);
    console.log(
      'criterion 3: a webview edit makes the document dirty; save writes it and clears it',
    );

    // `undo` restores the previous text exactly, which is the saved one, so not dirty any more.
    const second = await edit('yes');
    await waitFor('the document to be dirty', () => document.isDirty);
    await expectStep('undo', () => vscode.commands.executeCommand('undo'), first);
    await waitFor('the undo to clear the dirty marker', () => !document.isDirty);
    await expectStep('redo', () => vscode.commands.executeCommand('redo'), second);
    console.log('criterion 3: undo restores the previous text exactly, and redo the edit');

    // The webview's keys and the library's buttons go to the same undo stack, one step each.
    await expectStep('Ctrl+Z in the webview', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Y in the webview', () => hooks.press(key, 'y'), second);
    await expectStep('Ctrl+Shift+Z after Ctrl+Z', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Shift+Z', () => hooks.press(key, 'z', true), second);
    await expectStep('the Undo button', () => hooks.click(key, 'Undo (Ctrl+Z)'), first);
    await expectStep('the Redo button', () => hooks.click(key, 'Redo (Ctrl+Shift+Z)'), second);
    // Two steps back reach the opened text: one undo per key, none dropped.
    await expectStep('Ctrl+Z', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Z again', () => hooks.press(key, 'z'), original);
    await expectStep('Ctrl+Y', () => hooks.press(key, 'y'), first);
    console.log('criterion 3: webview keys and menu buttons undo and redo one step in VS Code');

    // Text mode holds typing back for one debounce interval. A save right after typing still
    // writes it: VS Code waits for the webview's `flush` answer.
    assert.equal(hooks.setMode(key, 'text'), true);
    await probeUntil('text mode', (p) => p.mode === 'text');
    const saved = document.getText();
    await hooks.type(key, ' /* saved */');
    await vscode.commands.executeCommand('workbench.action.files.save');
    assert.equal(document.getText(), `${saved} /* saved */`, 'the typing was not saved');
    await waitFor('the save', () => !document.isDirty);
    assert.equal(onDisk(), document.getText(), 'the file on disk is not the document text');
    console.log('criterion 3: typing held back by text mode is in the file a save writes');

    // An undo right after typing undoes that typing, as in VS Code's text editor: the typing
    // reaches the document first, then the undo takes it out again.
    const typed = document.getText();
    const seen = [];
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      // A dirty-marker change fires the event too, with no content change.
      if (event.document === document && event.contentChanges.length > 0) {
        seen.push(document.getText());
      }
    });
    try {
      await hooks.type(key, ' /* undone */');
      hooks.press(key, 'z');
      await waitFor('the typing and its undo', () => seen.length >= 2);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    } finally {
      listener.dispose();
    }
    assert.deepEqual(seen, [`${typed} /* undone */`, typed]);
    await probeUntil('the undo in the editor', (p) => p.content?.text === typed);
    await waitFor('the undo to clear the dirty marker', () => !document.isDirty);
    console.log('criterion 3: Ctrl+Z right after typing in text mode undoes the typing');

    // A save of a hidden tab does not ask its webview to flush: the webview is gone while the tab
    // is hidden, so the save would only wait for the flush timeout.
    const flushRequests = () => hooks.webviews().find((w) => w.uri === key).flushRequests;
    const asked = flushRequests();
    assert.ok(asked > 0, 'the saves of the visible tab asked for no flush');
    const other = await vscode.workspace.openTextDocument(path.join(OPEN, 'sample.json'));
    await vscode.window.showTextDocument(other, { preview: false });
    await waitFor('the editor tab to be hidden', () => {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      return active?.input?.uri?.toString() === other.uri.toString();
    });
    const newline = new vscode.WorkspaceEdit();
    newline.insert(uri, document.positionAt(document.getText().length), '\n');
    assert.equal(await vscode.workspace.applyEdit(newline), true);
    await waitFor('the document to be dirty', () => document.isDirty);
    assert.equal(await document.save(), true);
    assert.equal(onDisk(), document.getText(), 'the file on disk is not the document text');
    assert.equal(flushRequests(), asked, 'the save of a hidden tab asked its webview to flush');
    console.log('003 T7: saving a hidden tab does not wait for its webview');

    await closeAll();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};
