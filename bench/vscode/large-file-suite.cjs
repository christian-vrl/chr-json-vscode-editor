// 008 T5 benchmark (spec 008 criterion 11, UNK-041, plan R5 and R6). Runs inside VS Code (loaded
// through --extensionTestsPath by bench/vscode/run.mjs, CHR_BENCH_SUITE=large-file-suite.cjs) with
// the installed e2e .vsix, on the JSON, JSONC and JSON5 files `generate.mjs --formats` wrote. Each
// file opens in large-file mode (above 5 MiB), validated against large-file.schema.json through
// `json.schemas`/`json5.schemas` as a user would set them. Per run:
//   ready, render — as bench/vscode/suite.cjs: from `vscode.openWith` until the webview script
//            sends `ready`, and until the tree shows the root's "<n> items";
//   busy   — the extension host's time on the tab's format badge and on its schema validation
//            (the `$schema` lookup, compiling, parsing, validating and posting) from the open until
//            the webview showed the first result and 2.5 s more passed (the test hook's
//            `hostBusy`). Validation runs on open at every size here (the test hook lifts
//            UNK-041's limit): what pausing it saves above the limit;
//   validation — UNK-041's measure: one validation from the text alone, as the paused item's
//            click runs it (core's data-only parse plus Ajv, start to result posted);
//   heap   — the extension host's and the webview's JavaScript heap after that (plan R6);
//   edit   — at EDIT_MIB only, plan R5: "Edit anyway", then one tree edit timed as suite.cjs times
//            it (on the webview's clock until the editor is free again), with validation paused,
//            and the host's heap after it. Not for the big-id files (`json-ids`, `jsonc-ids`,
//            `json5-ids`, 015 T6), which UNK-068's rule measures on open only.
// Results go to the JSON file named by CHR_BENCH_OUT. A failure is recorded, not thrown.
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';
const RUNS = 3;
const EDIT_MIB = 50;
const TIMEOUT_MS = 180000;
const SETTLE_MS = 2500;
const SCHEMA = path.resolve(__dirname, '../large-file.schema.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what, predicate, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(5);
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

/** The first big id (generate.mjs BIG_ID_BASE): a big-id file's record i has the id 10^18 + i. */
const BIG_ID_BASE = 10n ** 18n;

/** The number of records, from the last record's id (generate.mjs numbers them from 0). */
function recordCount(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const tail = Buffer.alloc(Math.min(size, 1 << 20));
  fs.readSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  const ids = [...tail.toString('latin1').matchAll(/"?id"?: (\d+)/g)];
  const last = BigInt(ids.at(-1)[1]);
  return Number(last >= BIG_ID_BASE ? last - BIG_ID_BASE : last) + 1;
}

/** `json.schemas` for the JSON and JSONC files and `json5.schemas` for the JSON5 ones, written to
 *  the user settings file as a user would: VS Code refuses `update` for `json5.schemas`, which no
 *  installed extension registers. */
async function associateSchema(files) {
  const settingsFile = process.env.CHR_BENCH_USER_SETTINGS;
  if (!settingsFile) throw new Error('CHR_BENCH_USER_SETTINGS is not set');
  const url = vscode.Uri.file(SCHEMA).toString();
  const match = (formats) =>
    files
      .filter((f) => formats.includes(f.format.replace(/-ids$/, '')))
      .map((f) => `/${path.basename(f.path)}`);
  const settings = fs.existsSync(settingsFile)
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    : {};
  settings['json.schemas'] = [{ fileMatch: match(['json', 'jsonc']), url }];
  settings['json5.schemas'] = [{ fileMatch: match(['json5']), url }];
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  const globalValue = (section) =>
    vscode.workspace.getConfiguration(section).inspect('schemas')?.globalValue;
  await waitFor('json.schemas and json5.schemas from settings.json', () =>
    ['json', 'json5'].every((section) => Array.isArray(globalValue(section))),
  );
}

async function timeOpen(hooks, uri, records) {
  const key = uri.toString();
  const before = new Set(hooks.webviews());
  const start = performance.now();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  let view;
  await waitFor('the webview script to send ready', () => {
    view = hooks.webviews().find((s) => !before.has(s) && s.uri === key && s.scriptLoaded);
    return view !== undefined;
  });
  const ready = performance.now();
  await withTimeout('the tree to show the document', hooks.whenShown(key, `${records} items`));
  const rendered = performance.now();
  return { view, readyMs: ready - start, renderMs: rendered - start };
}

/** The extension host's busy time on open, once the webview showed the first validation result. */
async function busyOnOpen(view) {
  await waitFor('the first validation result', () => view.validationsShown.length > 0);
  await sleep(SETTLE_MS);
  const [result] = view.validationsShown;
  const outcome = result.errors
    ? `${result.errors.length} errors`
    : `skipped: ${result.reason ?? 'no reason'}`;
  const { badgeMs, validationMs } = view.hostBusy;
  return { badgeMs, validationMs, ms: badgeMs + validationMs, outcome };
}

/** "Edit anyway", then one tree edit as suite.cjs times it, and the host's heap after it. */
async function timeUnlockedEdit(hooks, uri, view, run) {
  const key = uri.toString();
  await withTimeout(
    '"Edit anyway"',
    hooks.dom(key, [{ click: '.banner button', text: 'Edit anyway' }]),
  );
  await waitFor('the unlock', () => view.largeFile && view.largeFile.unlocked);
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
    const shownMs = await withTimeout('the tree to show the edit', hooks.whenShown(key, value));
    const ms = await withTimeout('the editor to settle', hooks.whenSettled(key));
    if (changedAt === undefined) throw new Error('the document never changed');
    return { ms, shownMs, hostMs: changedAt - start, hostHeap: hooks.hostMemory().heapUsed };
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
  if (!hooks || !hooks.timeValidation) {
    throw new Error('no test hooks: build the .vsix with CHR_TEST_HOOKS=1 pnpm package');
  }
  await associateSchema(files);
  const validationLimit = hooks.validationLimit(undefined);

  const results = {
    vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    runs: RUNS,
    editMib: EDIT_MIB,
    validationLimit,
    files: [],
  };
  for (const file of files) {
    const uri = vscode.Uri.file(file.path);
    const records = recordCount(file.path);
    const entry = {
      format: file.format,
      mib: file.mib,
      bytes: fs.statSync(file.path).size,
      records,
      open: [],
      busy: [],
      validation: [],
      heap: [],
      edit: [],
      errors: [],
    };
    results.files.push(entry);
    console.log(`bench: ${file.format} ${file.mib} MiB, ${records} records`);
    for (let run = 0; run < RUNS; run++) {
      await closeAll();
      // Validation runs on open at every size (busy), whatever UNK-041's limit.
      hooks.validationLimit(Number.MAX_SAFE_INTEGER);
      let view;
      try {
        const opened = await timeOpen(hooks, uri, records);
        view = opened.view;
        entry.open.push({ readyMs: opened.readyMs, renderMs: opened.renderMs });
        if (!view.largeFile) throw new Error('the file did not open in large-file mode');
        entry.busy.push(await busyOnOpen(view));
        const key = uri.toString();
        const shown = view.validationsShown.length;
        const ms = hooks.timeValidation(key);
        await waitFor('the validation result', () => view.validationsShown.length > shown);
        const valid = view.validationsShown.at(-1).errors?.length === 0;
        entry.validation.push({ ms, valid });
        entry.heap.push({
          host: hooks.hostMemory().heapUsed,
          webview: await withTimeout('the webview heap', hooks.webviewHeap(key)),
        });
      } catch (error) {
        entry.errors.push({ run: run + 1, error: message(error) });
        continue;
      }
      if (file.mib === EDIT_MIB && !file.format.endsWith('-ids')) {
        // Plan R5 with validation paused, as above UNK-041's limit.
        hooks.validationLimit(0);
        try {
          entry.edit.push(await timeUnlockedEdit(hooks, uri, view, run));
        } catch (error) {
          entry.errors.push({ run: run + 1, error: `edit: ${message(error)}` });
        }
      }
    }
    await closeAll();
    hooks.validationLimit(undefined);
    console.log(`bench: ${JSON.stringify(entry)}`);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
};
