// Gate for 019 T5 (spec 019 criterion 6, the edit part; UNK-088 ★), run by suite.cjs inside VS Code.
// With `"[json]": {"editor.tabSize": 4, "editor.insertSpaces": true}`, a tree-mode edit that gives a
// one-line .json a multi-line object (R1) and an empty .json's first edit (R15) write 4-space
// indented text; with `"editor.insertSpaces": false` a tab; a document indented by 3 spaces keeps
// 3 either way (002 R1). The edits go through the webview as sync.cjs sends golden patches. The
// commands' part of criterion 6 is in csv.cjs, jsonLines.cjs, generateSchema.cjs and import.cjs.
// (Adding a member to a one-line object keeps it on one line, 002 R3, so no indent is written
// there; the R1 case is the one-line file whose root becomes a multi-line object.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { CRITERION_6, withIndent } = require('./indent.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const VALUE = { name: 'x', tags: [1, 2] };
/** `VALUE` laid out with `unit`, as `JSON.stringify(VALUE, null, unit)` writes it. */
const laidOut = (unit) => JSON.stringify(VALUE, null, unit);

exports.runIndentSettings = async function runIndentSettings({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'indent-settings-'));

  async function probeUntil(uri, what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Writes `text` as a new .json file, opens it in the CHR JSON Editor (tree mode) and sends
   *  `patch` through the webview; resolves with the document's text after the edit. */
  async function edit(text, patch) {
    const file = path.join(fs.mkdtempSync(path.join(dir, 'case-')), 'data.json');
    fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    assert.equal(document.languageId, 'json');
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor('the webview', () =>
      hooks.webviews().some((w) => w.uri === uri.toString() && w.scriptLoaded),
    );
    await probeUntil(
      uri,
      'the document in the editor',
      (p) => p.mode !== null && p.content !== null,
    );
    const before = document.version;
    assert.equal(hooks.patch(uri.toString(), JSON.stringify(patch)), true);
    await waitFor('the edit', () => document.version > before);
    const after = document.getText();
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await closeAll();
    return after;
  }

  await closeAll();
  try {
    for (const [values, unit] of CRITERION_6) {
      await withIndent(waitFor, ['json'], values, async () => {
        const label = JSON.stringify(values);
        // R1: a one-line file gains a multi-line object.
        assert.equal(
          await edit('{"a": 1}', [{ op: 'replace', path: '', value: VALUE }]),
          laidOut(unit),
          `one-line .json with ${label}`,
        );
        // R15: an empty document's first edit, with a final newline.
        assert.equal(
          await edit('', [{ op: 'add', path: '', value: VALUE }]),
          `${laidOut(unit)}\n`,
          `empty .json with ${label}`,
        );
        // 002 R1: a document indented by 3 spaces keeps 3.
        assert.equal(
          await edit('{\n   "a": 1\n}\n', [{ op: 'add', path: '/b', value: { c: [2] } }]),
          '{\n   "a": 1,\n   "b": {\n      "c": [\n         2\n      ]\n   }\n}\n',
          `3-space .json with ${label}`,
        );
      });
    }
    console.log(
      'criterion 6: "[json]" tabSize 4 writes 4 spaces and insertSpaces false a tab for a one-line and an empty .json; 3 spaces stay 3',
    );
  } finally {
    await closeAll();
  }
};
