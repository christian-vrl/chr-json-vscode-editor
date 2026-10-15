// Web e2e, spec 013 criterion 4 (013 T4): spec 003 criteria 1–3, 10 and the format badge on the
// virtual scheme, as test/e2e/sync.cjs and undoSave.cjs check them on desktop. A `patch` sent
// through the test hook leaves the document text byte-equal to the golden expected file and dirty;
// save writes exactly those bytes (read back with `workspace.fs.readFile`); undo and redo move one
// step; an external WorkspaceEdit shows in the webview with nothing echoed back. Each case edits a
// copy under work/.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  copyToCase,
  equal,
  fixture,
  FORMATS,
  match,
  ok,
  openCustom,
  probeUntil,
  readText,
  sleep,
  view,
  waitFor,
  withIndent,
} from './util';

const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
/** Long enough for a second, wrong undo to have landed: one message round trip and more. */
const SETTLE_MS = 500;

describe('editing on the virtual scheme (spec 013 criterion 4)', () => {
  it('applies golden patches through the webview byte for byte, and saves them', async () => {
    const hooks = await activateHooks();
    const cases = JSON.parse(await readText(fixture('golden', 'cases.json'))) as Record<
      string,
      string[]
    >;
    // The golden expected bytes are core's, with its default 2-space indent where the input has
    // none (R1, R15: json/add-document-empty); the host passes VS Code's indent instead (spec 019
    // I1), so the corpus is replayed with `editor.tabSize` 2.
    await withIndent({ tabSize: 2, insertSpaces: true }, async () => {
      for (const format of FORMATS) {
        equal(cases[format]?.length, 10, `${format}: golden cases`);
        for (const name of cases[format]!) {
          const from = fixture('golden', format, name);
          const uri = await copyToCase('golden', vscode.Uri.joinPath(from, `input.${format}`));
          const expected = await readText(vscode.Uri.joinPath(from, `expected.${format}`));
          // As text: the editor reads it, big numbers exactly (spec 015).
          const patch = await readText(vscode.Uri.joinPath(from, 'patch.json'));
          const document = await openCustom(hooks, uri);
          const before = document.version;
          equal(hooks.patch(uri.toString(), patch), true, `${format}/${name}: patch`);
          await waitFor(`${format}/${name} to be edited`, () => document.version > before);
          equal(document.getText(), expected, `${format}/${name}: document text`);
          await waitFor(`${format}/${name} to be dirty`, () => document.isDirty);
          // Text mode shows the host's new text, not an echo of its own (spec 003 criterion 10).
          await hooks.whenSettled(uri.toString());
          equal(hooks.setMode(uri.toString(), 'text'), true, 'setMode');
          await probeUntil(
            hooks,
            uri,
            `${format}/${name} in the webview`,
            (p) => p.mode === 'text' && (p.content as { text?: string })?.text === expected,
          );
          equal(view(hooks, uri).editsReceived, 1, `${format}/${name}: edits sent`);
          equal(await document.save(), true, `${format}/${name}: save`);
          equal(await readText(uri), expected, `${format}/${name}: saved bytes`);
          await closeAll();
        }
        console.log(`criterion 4: 10 ${format} golden cases applied through the webview and saved`);
      }
    });
  });

  it('shows an external WorkspaceEdit in the webview and echoes nothing back', async () => {
    const hooks = await activateHooks();
    const uri = await copyToCase('external', fixture('fixtures', 'open', 'sample.jsonc'));
    const document = await openCustom(hooks, uri);
    const original = document.getText();
    const edit = new vscode.WorkspaceEdit();
    const at = original.indexOf('true');
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(at), document.positionAt(at + 4)),
      'false',
    );
    equal(await vscode.workspace.applyEdit(edit), true, 'applyEdit');
    const version = document.version;
    const changed = document.getText();
    await probeUntil(
      hooks,
      uri,
      'the external edit in the webview',
      (p) => (p.content as { text?: string })?.text === changed,
    );
    await sleep(SETTLE_MS);
    equal(document.version, version, 'the webview edited the document back');
    equal(view(hooks, uri).editsReceived, 0, 'the webview sent an edit');

    // Comments stay in every mode, and a tree edit keeps them (spec 003 criterion 10).
    const comments = changed.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];
    ok(comments.length > 0, 'sample.jsonc has no comments');
    for (const mode of ['text', 'table', 'tree'] as const) {
      equal(hooks.setMode(uri.toString(), mode), true, 'setMode');
      const probe = await probeUntil(hooks, uri, `${mode} mode`, (p) => p.mode === mode);
      if (mode === 'text') {
        for (const comment of comments)
          ok(probe.shownText.includes(comment.trim()), `text mode lost ${comment}`);
      }
    }
    const before = document.version;
    hooks.patch(uri.toString(), [{ op: 'replace', path: '/name', value: 'Renamed' }]);
    await waitFor('the rename', () => document.version > before);
    for (const comment of comments) ok(document.getText().includes(comment), `lost ${comment}`);
    match(document.getText(), /Renamed/, 'renamed');
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await waitFor('the revert', () => !document.isDirty);
    await closeAll();
  });

  it('keeps undo, redo and save in VS Code, one step each', async () => {
    const hooks = await activateHooks();
    const uri = await copyToCase('undo', fixture('fixtures', 'open', 'sample.jsonc'));
    const key = uri.toString();
    const document = await openCustom(hooks, uri);
    const original = document.getText();
    equal(document.isDirty, false, 'dirty on open');
    const shown = (text: string) => (p: { content: unknown }) =>
      (p.content as { text?: string } | null)?.text === text;

    async function edit(value: unknown): Promise<string> {
      const before = document.getText();
      equal(hooks.patch(key, [{ op: 'replace', path: '/offline', value }]), true, 'patch');
      await waitFor(`the edit to ${JSON.stringify(value)}`, () => document.getText() !== before);
      await probeUntil(hooks, uri, 'the edit in the editor', shown(document.getText()));
      return document.getText();
    }

    async function expectStep(what: string, step: () => unknown, text: string): Promise<void> {
      await step();
      await waitFor(`${what} to give the expected text`, () => document.getText() === text);
      await sleep(SETTLE_MS);
      equal(document.getText(), text, `${what} moved more than one step`);
      await probeUntil(hooks, uri, `${what} in the editor`, shown(text));
    }

    // A webview edit makes the document dirty; saving writes exactly its text.
    const first = await edit(false);
    await waitFor('the document to be dirty', () => document.isDirty);
    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor('the save', () => !document.isDirty);
    equal(await readText(uri), first, 'saved bytes');

    const second = await edit('yes');
    await waitFor('the document to be dirty', () => document.isDirty);
    await expectStep('undo', () => vscode.commands.executeCommand('undo'), first);
    await waitFor('the undo to clear the dirty marker', () => !document.isDirty);
    await expectStep('redo', () => vscode.commands.executeCommand('redo'), second);

    // The webview's keys and the library's buttons go to the same undo stack.
    await expectStep('Ctrl+Z in the webview', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Y in the webview', () => hooks.press(key, 'y'), second);
    await expectStep('Ctrl+Z', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Shift+Z', () => hooks.press(key, 'z', true), second);
    await expectStep('the Undo button', () => hooks.click(key, 'Undo (Ctrl+Z)'), first);
    await expectStep('the Redo button', () => hooks.click(key, 'Redo (Ctrl+Shift+Z)'), second);
    await expectStep('Ctrl+Z', () => hooks.press(key, 'z'), first);
    await expectStep('Ctrl+Z again', () => hooks.press(key, 'z'), original);
    await expectStep('Ctrl+Y', () => hooks.press(key, 'y'), first);

    // Typing that text mode still holds back reaches the file a save right after writes.
    equal(hooks.setMode(key, 'text'), true, 'setMode');
    await probeUntil(hooks, uri, 'text mode', (p) => p.mode === 'text');
    const saved = document.getText();
    await hooks.type(key, ' /* saved */');
    await vscode.commands.executeCommand('workbench.action.files.save');
    equal(document.getText(), `${saved} /* saved */`, 'the typing was not saved');
    await waitFor('the save', () => !document.isDirty);
    equal(await readText(uri), document.getText(), 'saved bytes after typing');
    await closeAll();
  });

  it('Change Format re-parses in the host and the webview without changing the bytes', async () => {
    const hooks = await activateHooks();
    const labels = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };
    for (const detected of FORMATS) {
      const uri = await copyToCase('format', fixture('fixtures', 'open', `sample.${detected}`));
      const document = await openCustom(hooks, uri);
      const bytes = document.getText();
      const version = document.version;
      const badge = () => hooks.formatBadge();
      await waitFor(
        `the ${detected} badge`,
        () => badge().visible && badge().uri === uri.toString(),
      );
      equal(badge().command, SELECT_FORMAT_COMMAND, 'badge command');
      equal(badge().state?.detected, detected, 'detected format');
      equal(badge().text, labels[detected], 'badge text');
      for (const other of [...FORMATS.filter((f) => f !== detected), detected]) {
        await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, other);
        await waitFor(`${detected} as ${other}`, () => badge().state?.format === other);
        ok(badge().text.endsWith(labels[other]), `${detected} as ${other}: ${badge().text}`);
        await probeUntil(hooks, uri, `the ${other} label in the webview`, (p) => {
          return p.format === labels[other];
        });
        equal(document.getText(), bytes, `${detected} as ${other}: text changed`);
        equal(document.version, version, `${detected} as ${other}: edited`);
        equal(document.isDirty, false, `${detected} as ${other}: dirty`);
      }
      await closeAll();
    }
  });
});
