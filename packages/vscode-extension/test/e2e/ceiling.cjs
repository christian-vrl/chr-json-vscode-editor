// Gate for 008 T4 (spec 008 criterion 9), run by suite.cjs inside VS Code. First it measures VS
// Code's sync limit for extensions with files just at and above 50 × 2^20 bytes: `openTextDocument`
// opens the first and rejects the second, and a file with a byte order mark in front of the same
// text still opens, so the limit counts the text, not the bytes on disk. Then "Open in CHR JSON
// Editor" on a file above the limit on disk shows the message with "Open as Text" and opens
// nothing, from the explorer (a URI) and from the palette (the active text tab); "Open as Text"
// opens it in VS Code's text editor. A file at the limit still opens in CHR JSON Editor. The files
// are generated in the profile's scratch folder, which run.mjs deletes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const LIMIT = 50 * 1024 * 1024;
const BOM = '﻿';

/** An ASCII JSON array of `bytes` bytes, padded with spaces before the closing bracket. */
function documentText(bytes) {
  const line = '  {"id": 1, "name": "alpha", "tags": ["a", "b"]},\n';
  const count = Math.floor((bytes - 64) / line.length);
  const body = `[\n${line.repeat(count)}  {"id": 2}`;
  const text = body + ' '.repeat(bytes - body.length - 2) + '\n]';
  assert.equal(text.length, bytes);
  return text;
}

function tabsFor(uri) {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input && tab.input.uri && tab.input.uri.toString() === uri.toString());
}

exports.runCeiling = async function runCeiling({ hooks, waitFor, closeAll, expectOnly, isCustom }) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'ceiling-'));
  const at = vscode.Uri.file(path.join(dir, 'at-limit.json'));
  const over = vscode.Uri.file(path.join(dir, 'over-limit.json'));
  const bom = vscode.Uri.file(path.join(dir, 'bom-at-limit.json'));
  const text = documentText(LIMIT);
  fs.writeFileSync(at.fsPath, text);
  fs.writeFileSync(over.fsPath, text.slice(0, -1) + ' ]');
  fs.writeFileSync(bom.fsPath, BOM + text);
  assert.equal(fs.statSync(at.fsPath).size, LIMIT);
  assert.equal(fs.statSync(over.fsPath).size, LIMIT + 1);
  assert.equal(fs.statSync(bom.fsPath).size, LIMIT + 3);

  // The measurement (T4, plan risk R4): the largest text VS Code hands to extensions.
  const atDoc = await vscode.workspace.openTextDocument(at);
  assert.equal(atDoc.getText().length, LIMIT);
  await assert.rejects(
    Promise.resolve(vscode.workspace.openTextDocument(over)),
    /Files above 50MB cannot be synchronized with extensions/,
  );
  const bomDoc = await vscode.workspace.openTextDocument(bom);
  assert.equal(bomDoc.getText().length, LIMIT);
  console.log(
    `sync limit: ${LIMIT} bytes opens, ${LIMIT + 1} does not; a BOM in front of ${LIMIT} opens`,
  );

  // Above the limit on disk: the message, and no editor opens when it is dismissed.
  const message = (name, bytes) =>
    `${name} is ${(Math.floor((bytes * 10) / (1024 * 1024)) / 10).toFixed(1)} MiB. VS Code does ` +
    `not pass files above 50 MB to extensions, so CHR JSON Editor can't open it.`;
  hooks.ceiling(false);
  for (const [uri, bytes] of [
    [over, LIMIT + 1],
    // Criterion 9 measures the size on disk, so a BOM over the limit is refused although its text
    // would sync (sizeCeiling.ts).
    [bom, LIMIT + 3],
  ]) {
    await closeAll();
    const name = path.basename(uri.fsPath);
    await vscode.commands.executeCommand(OPEN_COMMAND, uri);
    assert.deepEqual(hooks.ceiling(false), [message(name, bytes)], `${name}: message`);
    assert.equal(tabsFor(uri).length, 0, `${name}: an editor opened`);
    console.log(`${name}: "${message(name, bytes)}"`);
  }

  // "Open as Text" opens VS Code's text editor; from that tab (the palette), the same message.
  await closeAll();
  hooks.ceiling(true);
  await vscode.commands.executeCommand(OPEN_COMMAND, over);
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  await expectOnly(over, 'text', isText);
  assert.deepEqual(hooks.ceiling(false), [message('over-limit.json', LIMIT + 1)]);
  await vscode.commands.executeCommand(OPEN_COMMAND);
  assert.deepEqual(hooks.ceiling(undefined), [message('over-limit.json', LIMIT + 1)]);
  await expectOnly(over, 'text', isText);
  console.log('over-limit.json: "Open as Text" opens the text editor; the palette refuses too');

  // At the limit: the command opens CHR JSON Editor with no message. Large-file mode itself is
  // criterion 1's (008 T3).
  await closeAll();
  hooks.ceiling(false);
  await vscode.commands.executeCommand(OPEN_COMMAND, at);
  await expectOnly(at, 'custom', isCustom);
  const view = () => hooks.webviews().find((w) => w.uri === at.toString());
  await waitFor('the at-limit.json webview script to run', () => view()?.scriptLoaded, 120000);
  assert.deepEqual(hooks.ceiling(undefined), []);
  await closeAll();
  console.log('at-limit.json: opens in CHR JSON Editor');
};
