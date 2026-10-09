// Runs inside VS Code (loaded through --extensionTestsPath by bench/vscode/run.mjs) with the
// installed e2e .vsix, end to end in the custom editor's webview (after 003 T5). For each file:
//   open   — from `vscode.openWith` until the webview script has sent `ready` (VS Code read the
//            file, synced it to the extension host and loaded webview.js);
//   render — from the same start until the tree shows the document's root ("<n> items", which
//            needs the whole text sent to the webview and parsed by core there). This is what a
//            user waits for, so UNK-014's "open" is this number.
//   edit   — one tree edit made through the webview's edit path (test hook `patch`: the library
//            applies it, as a tree edit does, and the same `edit` message goes to the host). On
//            the webview's clock, where the edit starts: until the tree shows the value (`shown`)
//            and until the host's answer is in and the editor is free again (`ms`, the edit). On
//            the host's clock: from sending the patch until the document changed (`host`: core's
//            applyPatch and the WorkspaceEdit).
// Open and `host` are on the extension host's clock, so they include the messages between host and
// webview. Results go to the JSON file named by CHR_BENCH_OUT. A failure is recorded, not thrown,
// so a size VS Code refuses still leaves the others measured.
const fs = require('node:fs');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';
const RUNS = 3;
const TIMEOUT_MS = 120000;

async function waitFor(what, predicate, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function withTimeout(what, promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${TIMEOUT_MS} ms waiting for ${what}`)),
        TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function closeAll() {
  // The benchmark's edits are reverted first so closing never asks to save.
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

/** The number of records, from the last record's id (bench/generate.mjs numbers them from 0). */
function recordCount(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const tail = Buffer.alloc(Math.min(size, 1 << 20));
  fs.readSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  const ids = [...tail.toString('latin1').matchAll(/"id": (\d+)/g)];
  return Number(ids.at(-1)[1]) + 1;
}

async function timeOpen(hooks, uri, records) {
  const key = uri.toString();
  const before = new Set(hooks.webviews());
  const start = performance.now();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  await waitFor('the webview script to send ready', () =>
    hooks.webviews().some((s) => !before.has(s) && s.uri === key && s.scriptLoaded),
  );
  const ready = performance.now();
  await withTimeout('the tree to show the document', hooks.whenShown(key, `${records} items`));
  const rendered = performance.now();
  return { readyMs: ready - start, renderMs: rendered - start };
}

async function timeEdit(hooks, uri, run) {
  const key = uri.toString();
  const value = `edited-${run}-${Date.now()}`;
  let changedAt;
  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === key && event.contentChanges.length > 0) {
      changedAt ??= performance.now();
    }
  });
  try {
    const start = performance.now();
    if (!hooks.patch(key, [{ op: 'replace', path: '/0/name', value }])) {
      throw new Error('no editor shows the file');
    }
    // The edit starts in the webview, so it is timed there: from the edit until the tree shows it,
    // and until the webview has the host's answer and is free again.
    const shownMs = await withTimeout('the tree to show the edit', hooks.whenShown(key, value));
    const ms = await withTimeout('the editor to settle', hooks.whenSettled(key));
    if (changedAt === undefined) throw new Error('the document never changed');
    return { ms, shownMs, hostMs: changedAt - start };
  } finally {
    listener.dispose();
  }
}

exports.run = async function run() {
  const out = process.env.CHR_BENCH_OUT;
  const files = JSON.parse(process.env.CHR_BENCH_FILES ?? '[]');
  if (!out || !files.length) throw new Error('CHR_BENCH_OUT and CHR_BENCH_FILES must be set');

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not installed`);
  const hooks = (await extension.activate()).testHooks;
  if (!hooks || !hooks.whenSettled) {
    throw new Error('no test hooks: build the .vsix with CHR_TEST_HOOKS=1 pnpm package');
  }

  const results = {
    vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    runs: RUNS,
    sizes: [],
  };
  for (const file of files) {
    const uri = vscode.Uri.file(file.path);
    const records = recordCount(file.path);
    const entry = { mib: file.mib, bytes: fs.statSync(file.path).size, open: [], edit: [] };
    results.sizes.push(entry);
    console.log(`bench: ${file.mib} MiB, ${records} records`);
    for (let run = 0; run < RUNS; run++) {
      await closeAll();
      try {
        entry.open.push(await timeOpen(hooks, uri, records));
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
      try {
        entry.edit.push(await timeEdit(hooks, uri, run));
      } catch (error) {
        entry.edit.push({ error: message(error) });
      }
    }
    await closeAll();
    console.log(`bench: ${JSON.stringify(entry)}`);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
};
