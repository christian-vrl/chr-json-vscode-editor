// Gate for 010 T4 (spec 010 criterion 10 in a large-file tab), run by suite.cjs inside VS Code on
// 008's 6 MiB fixtures (largeFile.cjs `documentText`). "Size" is the UTF-8 length of the document's
// text when "Smart Format" runs, whatever mode the tab opened in:
// - a locked 6 MiB tab, in each format: nothing changes and the size message shows;
// - a locked tab whose text another editor has shrunk to 5 MiB: nothing changes and the read-only
//   message shows (spec 008 criterion 2);
// - unlocked with "Edit anyway": at 6 MiB, and at 5 MiB plus one byte counted in UTF-8, nothing
//   changes and the size message shows; edited down to exactly 5 MiB, it smart-formats as one edit,
//   dirty and not saved, and one undo restores the text.
// The fixtures are written into run.mjs's scratch folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const COMMAND = 'chrJsonEditor.smartFormat';
const THRESHOLD = 5 * 1024 * 1024;
const SIX_MIB = 6 * 1024 * 1024;
const FORMATS = ['json', 'jsonc', 'json5'];
const TOO_LARGE =
  'Smart Format is off for documents above 5 MiB because it can take a long time. Use Format instead.';
const READ_ONLY_MESSAGE =
  'This large file is read-only. Choose "Edit anyway" to edit it, or "Open as Text".';

/** `[1]` padded with spaces to `bytes` bytes; smart-formatted it is `[1]\n`. */
const sized = (bytes) => `[${' '.repeat(bytes - 4)}1]\n`;

exports.runSmartFormatLargeFile = async function runSmartFormatLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'smart-format-large-file-'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  async function probeUntil(uri, what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        const rest = { ...probe, content: probe.content && '(omitted)' };
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(rest)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Whether the editor shows the data `[1]`. */
  const showsOne = (probe) => {
    if (!probe.content) return false;
    if ('json' in probe.content) return JSON.stringify(probe.content.json) === '[1]';
    return probe.content.text.trim() === '[1]' || probe.content.text === sized(THRESHOLD);
  };

  /** Opens `name` with `text` in CHR JSON Editor, waits for its tree, and checks the tab is a
   *  locked large-file tab. */
  async function openLarge(name, text) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${name} webview`, () => view(uri)?.scriptLoaded, 60000);
    await probeUntil(uri, 'the document in the editor', (p) => p.mode === 'tree' && !!p.content);
    assert.deepEqual(view(uri).largeFile, { bytes: Buffer.byteLength(text), unlocked: false });
    return { file, uri, document };
  }

  /** Replaces the whole document with `text` from outside the editor and waits for the tab to
   *  show it. */
  async function replaceAll({ uri, document }, text) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      text,
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.equal(document.getText(), text);
    await probeUntil(uri, 'the new text in the editor', (p) => p.mode === 'tree' && showsOne(p));
  }

  /** Runs the command on the active tab and checks it changed nothing and showed `message`. */
  async function refused(label, { file, document }, message) {
    const text = document.getText();
    const version = document.version;
    const dirty = document.isDirty;
    const onDisk = fs.readFileSync(file, 'utf8');
    await vscode.commands.executeCommand(COMMAND);
    assert.ok(document.getText() === text, `${label}: the text changed`);
    assert.equal(document.version, version, `${label}: an edit was made`);
    assert.equal(document.isDirty, dirty, `${label}: dirty state changed`);
    assert.ok(fs.readFileSync(file, 'utf8') === onDisk, `${label}: the file changed`);
    assert.deepEqual(hooks.smartFormatMessages(), [message], `${label}: the message`);
  }

  try {
    await closeAll();
    hooks.smartFormatMessages();

    // Locked 6 MiB tabs: the size message, in each format.
    for (const format of FORMATS) {
      const tab = await openLarge(`locked.${format}`, documentText(format, SIX_MIB));
      await refused(`locked 6 MiB ${format}`, tab, TOO_LARGE);
      assert.deepEqual(view(tab.uri).largeFile, { bytes: SIX_MIB, unlocked: false });
      await closeAll();
    }
    console.log('criterion 10: a locked 6 MiB tab is not smart-formatted, in each format');

    // A locked tab shrunk to 5 MiB by another editor stays locked: the read-only message.
    const locked = await openLarge('shrunk-locked.json', documentText('json', SIX_MIB));
    await replaceAll(locked, sized(THRESHOLD));
    assert.deepEqual(view(locked.uri).largeFile, { bytes: SIX_MIB, unlocked: false });
    await refused('locked tab at 5 MiB', locked, READ_ONLY_MESSAGE);
    await locked.document.save();
    await closeAll();
    console.log('criterion 10: a locked tab shrunk to 5 MiB says it is read-only');

    // Unlocked: off above the threshold, by the text's UTF-8 length now; on at or below it.
    const tab = await openLarge('unlocked.json', documentText('json', SIX_MIB));
    await hooks.dom(tab.uri.toString(), [{ click: '.banner button', text: 'Edit anyway' }]);
    await waitFor('the unlock', () => view(tab.uri).largeFile.unlocked);
    await refused('unlocked 6 MiB', tab, TOO_LARGE);

    // One byte over, counted in UTF-8: a two-byte character in a string, fewer UTF-16 units.
    const over = `["é${' '.repeat(THRESHOLD - 6)}"]\n`;
    assert.equal(Buffer.byteLength(over), THRESHOLD + 1);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      tab.uri,
      new vscode.Range(
        tab.document.positionAt(0),
        tab.document.positionAt(tab.document.getText().length),
      ),
      over,
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    await probeUntil(tab.uri, 'the 5 MiB + 1 text', (p) => p.shownText.includes(': é'));
    await refused('unlocked 5 MiB + 1 byte', tab, TOO_LARGE);

    // Edited down to exactly 5 MiB: smart-formatted as one edit, dirty, not saved, one undo back.
    const at = sized(THRESHOLD);
    await replaceAll(tab, at);
    assert.deepEqual(view(tab.uri).largeFile, { bytes: SIX_MIB, unlocked: true });
    const onDisk = fs.readFileSync(tab.file, 'utf8');
    const version = tab.document.version;
    await vscode.commands.executeCommand(COMMAND);
    await waitFor('5 MiB: smart-formatted', () => tab.document.getText() === '[1]\n', 30000);
    assert.equal(tab.document.version, version + 1, 'unlocked 5 MiB: one edit');
    assert.equal(tab.document.isDirty, true, 'unlocked 5 MiB: dirty');
    assert.ok(fs.readFileSync(tab.file, 'utf8') === onDisk, 'unlocked 5 MiB: saved');
    assert.deepEqual(hooks.smartFormatMessages(), [], 'unlocked 5 MiB: a message');
    await probeUntil(tab.uri, 'the smart-formatted text in the editor', showsOne);
    await vscode.commands.executeCommand('undo');
    await waitFor('the undo', () => tab.document.getText() === at, 30000);
    const probe = await hooks.probe(tab.uri.toString());
    assert.deepEqual(probe.violations, [], 'CSP violations');
    console.log('criterion 10: an unlocked tab edited down to 5 MiB smart-formats; one undo back');

    await tab.document.save();
    await closeAll();
  } finally {
    hooks.smartFormatMessages();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
