// Runs inside VS Code (loaded through --extensionTestsPath by bench/vscode/run.mjs) with the
// installed e2e .vsix. For each benchmark file it times, in this order:
//   open — `vscode.openWith` into the custom editor until its webview script has reported that it
//          ran (test hook `scriptLoaded`). On main the webview is still the 003 T4 placeholder, so
//          this covers VS Code reading the file, syncing it to the extension host and creating the
//          webview, but not sending the text to the webview (003 T5).
//   edit — what the extension host will do for one tree edit in 003 T5: read the document text,
//          `core` applyPatch (style-preserving `replace` of one string), reduce the result to the
//          one changed span, and apply it as a WorkspaceEdit until the document has the new text.
// Results go to the JSON file named by CHR_BENCH_OUT. A failure is recorded, not thrown, so one
// size that VS Code refuses still leaves the others measured.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';
const RUNS = 3;
const TIMEOUT_MS = 60000;
const CORE = path.resolve(__dirname, '../../packages/core/dist/index.js');

async function waitFor(what, predicate, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function closeAll() {
  // The benchmark's edit is reverted first so closing never asks to save.
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (active && active.isDirty) {
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((g) => !g.tabs.length),
  );
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function timeOpen(hooks, uri) {
  const before = new Set(hooks.webviews());
  const start = performance.now();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  let snapshot;
  await waitFor('the webview script to run', () => {
    snapshot = hooks
      .webviews()
      .find((s) => !before.has(s) && s.uri === uri.toString() && s.scriptLoaded);
    return snapshot !== undefined;
  });
  return performance.now() - start;
}

/** The single span where `before` and `after` differ, as offsets into `before`. */
function changedSpan(before, after) {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore--;
    endAfter--;
  }
  return { start, end: endBefore, text: after.slice(start, endAfter) };
}

async function timeEdit(core, document, run) {
  const t0 = performance.now();
  const text = document.getText();
  const t1 = performance.now();
  // The last record's id, found without parsing (bench/generate.mjs numbers records from 0).
  const lastId = Number(/"id": (\d+)/.exec(text.slice(text.lastIndexOf('"id": ')))[1]);
  const target = Math.floor(lastId / 2);
  const t2 = performance.now();
  const value = `edited-${run}-${target}`;
  const next = core.jsonAdapter.applyPatch(text, [
    { op: 'replace', path: `/${target}/name`, value },
  ]);
  const t3 = performance.now();
  const span = changedSpan(text, next);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
    span.text,
  );
  const t4 = performance.now();
  const applied = await vscode.workspace.applyEdit(edit);
  const t5 = performance.now();
  if (!applied) throw new Error('workspace.applyEdit returned false');
  if (!document.getText().includes(`"name": "${value}"`)) {
    throw new Error('the document does not show the edit');
  }
  return {
    // Finding the record to edit is the benchmark's own work, not part of an edit.
    totalMs: t5 - t0 - (t2 - t1),
    getTextMs: t1 - t0,
    applyPatchMs: t3 - t2,
    spanMs: t4 - t3,
    applyEditMs: t5 - t4,
    changedChars: span.text.length,
  };
}

exports.run = async function run() {
  const out = process.env.CHR_BENCH_OUT;
  const files = JSON.parse(process.env.CHR_BENCH_FILES ?? '[]');
  if (!out || !files.length) throw new Error('CHR_BENCH_OUT and CHR_BENCH_FILES must be set');

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not installed`);
  const hooks = (await extension.activate()).testHooks;
  if (!hooks) throw new Error('no test hooks: build the .vsix with CHR_TEST_HOOKS=1 pnpm package');
  const core = await import(pathToFileURL(CORE).href);

  const results = {
    vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    runs: RUNS,
    sizes: [],
  };
  for (const file of files) {
    const uri = vscode.Uri.file(file.path);
    const entry = { mib: file.mib, bytes: fs.statSync(file.path).size, open: [], edit: [] };
    results.sizes.push(entry);
    console.log(`bench: ${file.mib} MiB`);
    for (let run = 0; run < RUNS; run++) {
      await closeAll();
      try {
        entry.open.push({ ms: await timeOpen(hooks, uri) });
      } catch (error) {
        // Ask VS Code directly why, since a custom editor that never resolves gives no reason.
        const reason = await vscode.workspace.openTextDocument(uri).then(
          () => 'openTextDocument succeeds',
          (e) => `openTextDocument: ${message(e)}`,
        );
        entry.open.push({ error: `${message(error)} (${reason})` });
        // The other runs would fail the same way and each costs the full timeout.
        break;
      }
      let document;
      try {
        document = await vscode.workspace.openTextDocument(uri);
        entry.edit.push(await timeEdit(core, document, run));
      } catch (error) {
        entry.edit.push({ error: message(error) });
      }
    }
    await closeAll();
    console.log(`bench: ${JSON.stringify(entry)}`);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
};
