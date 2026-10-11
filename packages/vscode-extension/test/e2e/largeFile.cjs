// Gate for 008 T3 (spec 008 criteria 1–5 and 8), run by suite.cjs inside VS Code. The fixtures are
// generated in the profile's scratch folder (run.mjs deletes it): JSON files of exactly 5,242,880
// and 5,242,881 bytes, the first with a UTF-8 BOM in front too, and 6 MiB JSON, JSONC and JSON5
// files whose first array item carries `"marker": "start"`.
// - Criterion 1: the threshold is the text's UTF-8 length when the tab opens, kept for the tab's
//   life and chosen again on reopen.
// - Criterion 2: a locked tab sends no `edit` for a tree patch; and when an `edit` or `undo` does
//   reach the host from it (plan R3), the host refuses the edit with the `read-only` error and
//   ignores the undo.
// - Criterion 3: the banner, and "Open as Text" replacing the tab with the text editor.
// - Criterion 4: "Edit anyway", kept across a webview reload, an edit, save and undo.
// - Criterion 5: an external edit reaches a locked tab and nothing is echoed back.
// - Criterion 8: while a locked tab is open, core keeps no parse of its text after open, the
//   badge, validation and a format change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const SELECT_FORMAT_COMMAND = 'chrJsonEditor.selectFormat';
const THRESHOLD = 5 * 1024 * 1024;
const SIX_MIB = 6 * 1024 * 1024;
const BOM = '﻿';
const LABELS = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };
const READ_ONLY_MESSAGE =
  'This large file is read-only. Choose "Edit anyway" to edit it, or "Open as Text".';
/** Long enough for a wrong edit or undo to have landed: one message round trip and more. */
const SETTLE_MS = 500;

/** The first item of every fixture's array, and how each format writes the rest. */
const SHAPES = {
  json: {
    head: '[\n  {"id": 0, "marker": "start"},\n',
    line: '  {"id": 1, "name": "alpha", "tags": ["a", "b"]},\n',
    tail: '  {"id": 2}\n]\n',
  },
  jsonc: {
    head: '// A large JSONC file\n[\n  {"id": 0, "marker": "start"}, // first\n',
    line: '  {"id": 1, "name": "alpha"}, /* item */\n',
    tail: '  {"id": 2},\n]\n',
  },
  json5: {
    head: "// A large JSON5 file\n[\n  {id: 0, marker: 'start'},\n",
    line: "  {id: 1, name: 'alpha', hex: 0x1F},\n",
    tail: '  {id: 2,},\n]\n',
  },
};

/** An ASCII document of `bytes` bytes in `format`, padded with spaces before its tail. */
function documentText(format, bytes) {
  const { head, line, tail } = SHAPES[format];
  const count = Math.floor((bytes - head.length - tail.length) / line.length);
  const body = head + line.repeat(count);
  const text = body + ' '.repeat(bytes - body.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(text), bytes);
  return text;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.runLargeFile = async function runLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'large-file-'));
  const write = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return vscode.Uri.file(file);
  };
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());
  const isText = (tab) => tab.input instanceof vscode.TabInputText;

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
      await sleep(200);
    }
  }

  /** Whether the editor holds `text`'s data, with the first item's marker `marker`. */
  const holds = (probe, text, marker) =>
    probe.content !== null &&
    ('text' in probe.content
      ? probe.content.text === text
      : Array.isArray(probe.content.json) && probe.content.json[0].marker === marker);

  /** Opens `uri` in CHR JSON Editor and waits until the editor holds the document. */
  async function open(uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${path.basename(uri.fsPath)} webview`, () => view(uri)?.scriptLoaded, 60000);
    await probeUntil(uri, 'the document in the editor', (p) => p.mode === 'tree' && p.content);
    return document;
  }

  /** The banner's text. */
  async function banner(uri) {
    const [shown] = await hooks.dom(uri.toString(), [{ read: '.banner span' }]);
    return shown.replace(/\s+/g, ' ').trim();
  }

  /** Waits until the page shows no banner. */
  async function noBanner(uri) {
    await hooks.dom(uri.toString(), [{ waitFor: '.toolbar' }, { waitFor: '.banner', gone: true }]);
  }

  const lockedBanner = (mib) => `Large file (${mib} MiB): read-only to stay fast.`;
  const unlockedBanner = (mib) => `Large file (${mib} MiB): edits may be slow.`;

  /** Core keeps no parse of the document's text (criterion 8). */
  function noParseKept(document, when) {
    const text = document.getText();
    assert.ok(!hooks.cachedParses().includes(text), `core keeps a parse of the text ${when}`);
  }

  // Criterion 1: the threshold, in UTF-8 bytes of the text.
  const atText = documentText('json', THRESHOLD);
  const at = write('at-threshold.json', atText);
  const over = write('over-threshold.json', documentText('json', THRESHOLD + 1));
  const bom = write('bom-at-threshold.json', BOM + atText);
  for (const [uri, expected] of [
    [at, null],
    [over, { bytes: THRESHOLD + 1, unlocked: false }],
    // VS Code leaves the BOM out of the text, so the text is at the threshold.
    [bom, null],
  ]) {
    await closeAll();
    await open(uri);
    const name = path.basename(uri.fsPath);
    assert.deepEqual(view(uri).largeFile, expected, `${name}: large-file state`);
    if (expected) assert.equal(await banner(uri), lockedBanner('5.0'), `${name}: banner`);
    else await noBanner(uri);
    console.log(`criterion 1: ${name} opens ${expected ? 'in large-file mode' : 'normally'}`);
  }

  // The mode stays for the tab's life whatever edits do to the size, and reopening chooses again.
  await closeAll();
  const atDocument = await open(at);
  const grow = new vscode.WorkspaceEdit();
  grow.insert(at, atDocument.positionAt(atDocument.getText().length), '\n');
  assert.ok(await vscode.workspace.applyEdit(grow));
  await atDocument.save();
  assert.equal(fs.statSync(at.fsPath).size, THRESHOLD + 1);
  assert.equal(view(at).largeFile, null, 'the mode changed with the size');
  await closeAll();
  await open(at);
  assert.deepEqual(view(at).largeFile, { bytes: THRESHOLD + 1, unlocked: false });
  console.log('criterion 1: the mode is kept for the tab and chosen again on reopen');

  // Criteria 2, 5 and 8 on a locked 6 MiB tab in each format.
  for (const format of ['json', 'jsonc', 'json5']) {
    await closeAll();
    const uri = write(`six.${format}`, documentText(format, SIX_MIB));
    const key = uri.toString();
    const document = await open(uri);
    const original = document.getText();
    assert.deepEqual(view(uri).largeFile, { bytes: SIX_MIB, unlocked: false });
    assert.equal(await banner(uri), lockedBanner('6.0'));
    const [modes] = await hooks.dom(key, [{ read: '.modes' }]);
    assert.match(modes, /Tree/);
    assert.match(modes, /Table/);
    assert.doesNotMatch(modes, /Text/, 'text mode is offered');
    noParseKept(document, 'after open');

    // The badge shows the detected format, parsed without an error.
    await waitFor('the badge', () => hooks.formatBadge().uri === key);
    assert.equal(hooks.formatBadge().text, LABELS[format]);
    assert.deepEqual(hooks.formatBadge().state.outcome, { kind: 'parsed', errors: 0, warnings: 0 });
    noParseKept(document, 'after the badge');

    // Validation runs on data-only reads.
    const shown = view(uri).validationsShown.length;
    assert.equal(hooks.setSchema(key, { type: 'array', maxItems: 1 }), true);
    await waitFor('the validation result', () => view(uri).validationsShown.length > shown);
    const [result] = view(uri).validationsShown.slice(-1);
    assert.deepEqual(
      result.errors.map((e) => e.keyword),
      ['maxItems'],
    );
    noParseKept(document, 'after validation');

    // Criterion 2: a tree patch sends no edit, and the document stays as it is.
    const version = document.version;
    const edits = view(uri).editsReceived;
    assert.equal(hooks.patch(key, [{ op: 'replace', path: '/0/marker', value: 'patched' }]), true);
    await sleep(SETTLE_MS);
    assert.equal(view(uri).editsReceived, edits, 'a locked tab sent an edit');
    assert.equal(document.version, version);

    // Plan R3: an edit that reaches the host anyway is refused with the read-only error.
    hooks.send(key, {
      type: 'edit',
      docVersion: version,
      change: { kind: 'patch', patch: [{ op: 'replace', path: '/0/marker', value: 'sent' }] },
    });
    await waitFor('the refusal', () => view(uri).readOnlyRefusals === 1);
    await sleep(SETTLE_MS);
    assert.equal(document.version, version, 'the host applied an edit from a locked tab');
    assert.equal(document.getText(), original);
    await probeUntil(uri, 'the read-only notice', (p) => p.notice === READ_ONLY_MESSAGE);

    // Criterion 5: an external edit shows, and nothing is echoed back.
    const offset = original.indexOf('start');
    const external = new vscode.WorkspaceEdit();
    external.replace(
      uri,
      new vscode.Range(document.positionAt(offset), document.positionAt(offset + 5)),
      'external',
    );
    assert.ok(await vscode.workspace.applyEdit(external));
    const changed = document.getText();
    await probeUntil(uri, 'the external edit', (p) => holds(p, changed, 'external'));
    await sleep(SETTLE_MS);
    assert.equal(view(uri).editsReceived, edits + 1, 'the external edit was echoed back');

    // Plan R3: an undo from a locked tab is ignored.
    hooks.send(key, { type: 'undo', docVersion: document.version });
    await waitFor('the ignored undo', () => view(uri).historyIgnored === 1);
    await sleep(SETTLE_MS);
    assert.equal(document.getText(), changed, 'an undo from a locked tab ran');
    await document.save();

    // Criterion 8: another format parses again with data-only reads, bytes unchanged.
    const other = format === 'json5' ? 'jsonc' : 'json5';
    await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, other);
    await waitFor('the badge to change', () => hooks.formatBadge().state.format === other);
    await probeUntil(uri, `the ${other} label`, (p) => p.format === LABELS[other]);
    assert.equal(document.getText(), changed);
    assert.equal(document.isDirty, false);
    noParseKept(document, 'after a format change');
    await vscode.commands.executeCommand(SELECT_FORMAT_COMMAND, format);
    await waitFor('the badge to change back', () => hooks.formatBadge().state.format === format);
    hooks.setSchema(key, undefined);
    noParseKept(document, 'at the end');
    console.log(
      `criteria 2, 5, 8: ${format} is read-only, refuses edits and undo, shows external edits, ` +
        'and core keeps no parse of it',
    );
  }

  // Criterion 4: "Edit anyway" unlocks the tab until it closes.
  await closeAll();
  const editable = write('edit.json', documentText('json', SIX_MIB));
  const editKey = editable.toString();
  const editDocument = await open(editable);
  const before = editDocument.getText();
  await hooks.dom(editKey, [{ click: '.banner button', text: 'Edit anyway' }]);
  await waitFor('the unlock', () => view(editable).largeFile.unlocked);
  assert.equal(await banner(editable), unlockedBanner('6.0'));
  await hooks.dom(editKey, [{ waitFor: '.banner button', text: 'Edit anyway', gone: true }]);
  // A reloaded webview gets the unlocked state back.
  const readies = view(editable).readies;
  await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
  await waitFor('the webview to reload', () => view(editable).readies > readies, 60000);
  await probeUntil(editable, 'the reloaded editor', (p) => p.mode === 'tree' && p.content);
  assert.equal(await banner(editable), unlockedBanner('6.0'));
  const [editModes] = await hooks.dom(editKey, [{ read: '.modes' }]);
  assert.doesNotMatch(editModes, /Text/, 'text mode is offered after "Edit anyway"');

  const expected = before.replace('"marker": "start"', '"marker": "edited"');
  assert.equal(hooks.patch(editKey, [{ op: 'replace', path: '/0/marker', value: 'edited' }]), true);
  await waitFor('the edit', () => editDocument.getText() !== before, 30000);
  assert.equal(editDocument.getText(), expected, 'the edit did not give the expected bytes');
  // VS Code marks the document dirty a moment after the change event.
  await waitFor('the document to be dirty', () => editDocument.isDirty);
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('the save', () => !editDocument.isDirty);
  assert.equal(fs.readFileSync(editable.fsPath, 'utf8'), expected);
  await vscode.commands.executeCommand('undo');
  await waitFor('the undo', () => editDocument.getText() === before, 30000);
  await editDocument.save();
  console.log('criterion 4: "Edit anyway" edits, saves and undoes; it survives a reload');

  await closeAll();
  await open(editable);
  assert.deepEqual(view(editable).largeFile, { bytes: SIX_MIB, unlocked: false });
  console.log('criterion 4: reopening the file is read-only again');

  // Criterion 3: "Open as Text" replaces the tab with VS Code's text editor, bytes unchanged.
  await closeAll();
  const asText = write('as-text.jsonc', documentText('jsonc', SIX_MIB));
  const textDocument = await open(asText);
  await hooks.dom(asText.toString(), [{ click: '.banner button', text: 'Open as Text' }]);
  await expectOnly(asText, 'text', isText);
  assert.equal(textDocument.getText(), fs.readFileSync(asText.fsPath, 'utf8'));
  assert.equal(textDocument.isDirty, false);
  console.log('criterion 3: "Open as Text" opens the text editor on the same bytes');
  await closeAll();
};
