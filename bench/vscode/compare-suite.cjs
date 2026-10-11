// 007 T5 benchmark in VS Code (evidence for UNK-037), loaded through --extensionTestsPath by
// bench/vscode/run.mjs with the installed e2e .vsix. For each size, the generated document (left)
// against its changed copy (right, bench/generate.mjs --changed), neither open in an editor:
//   open    — from running "Compare Selected" on the two files until the compare page shows both
//             trees with the differences marked (the root of each side carries `chr-diff-inside`)
//             and its counter reads "<n> differences". This includes the host reading and parsing
//             both documents and running `compare`, and the page receiving both texts, parsing them
//             and rendering. UNK-037's "open".
//   refresh — one live refresh (criterion 7): from applying a `WorkspaceEdit` to the right document
//             (one more record's name in capitals, same length) until the page's counter reads
//             "<n + 1> differences". It includes the panel's 100 ms pause after a change. UNK-037's
//             "live refresh after an edit". The edit is then undone, untimed.
// The size limit is lifted through the test hooks, so the panel opens above UNK-037's limit too.
// The page is read with the compare panel's probe, on the extension host's clock. Results go to
// the JSON file named by CHR_BENCH_OUT. A failure is recorded, not thrown, so a size that fails
// still leaves the others measured.
const fs = require('node:fs');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const COMPARE_SELECTED = 'chrJsonEditor.compareSelected';
const RUNS = 3;
const TIMEOUT_MS = 300000;
// bench/generate.mjs: every 100th record (index 50, 150, …) is changed in the right copy, and the
// names are `<word>-<index>` with ASCII words.
const CHANGED_EVERY = 100;
const CHANGED_AT = 50;

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

function withTimeout(what, promise, timeoutMs = TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function closeAll() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((g) => !g.tabs.length),
  );
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

function changedCount(records) {
  return Math.floor((records - 1 - CHANGED_AT) / CHANGED_EVERY) + 1;
}

/** Probes the page of the compare panel `title` until `predicate` holds. The page answers a probe
 *  once it is free, so a probe sent while it parses or renders waits for that. */
async function probeUntil(hooks, title, what, predicate) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last;
  for (;;) {
    last = await withTimeout(`a probe answer (${what})`, hooks.probeCompare(title));
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}; last counter: ${last && last.counter}`);
    }
    await sleep(5);
  }
}

const marked = (side) => side.tree && (side.marks['chr-diff-inside'] ?? []).includes('');

async function timeOpen(hooks, left, right, title, differences) {
  const before = hooks.compares().length;
  const start = performance.now();
  await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
  const snapshot = () =>
    hooks
      .compares()
      .slice(before)
      .find((s) => s.title === title && s.open);
  await waitFor('the compare page script', () => snapshot()?.scriptLoaded === true);
  await waitFor('the compare to be posted', () => snapshot().version > 0);
  const posted = performance.now();
  if (snapshot().differences.length !== differences) {
    throw new Error(`expected ${differences} differences, got ${snapshot().differences.length}`);
  }
  await probeUntil(
    hooks,
    title,
    'both trees with the differences marked',
    (p) => p.counter === `${differences} differences` && marked(p.left) && marked(p.right),
  );
  return { postedMs: posted - start, ms: performance.now() - start };
}

/** Replaces `from` with `to` (same length) in the document at its first match after `at`. */
async function replace(document, at, from, to) {
  const offset = document.getText().indexOf(from, at);
  if (offset < 0) throw new Error(`"${from}" is not in the document`);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(offset), document.positionAt(offset + from.length)),
    to,
  );
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('the edit was refused');
}

async function timeRefresh(hooks, right, title, differences) {
  const document = await vscode.workspace.openTextDocument(right);
  // Record 0 is unchanged in the right copy; its name in capitals adds one difference.
  const start = performance.now();
  await replace(document, 0, '"name": "alpha-0"', '"name": "ALPHA-0"');
  await probeUntil(
    hooks,
    title,
    'the edit in the panel',
    (p) => p.counter === `${differences + 1} differences`,
  );
  const ms = performance.now() - start;
  // Undo the edit. In bench run 38163897100 the 50 MiB document no longer held the edit by then
  // (cause not established: VS Code may drop an edited document that has no editor and read the
  // file again), so undo it only if it is there; either way the panel must show the starting
  // count again before the next run.
  const now = await vscode.workspace.openTextDocument(right);
  if (now.getText().includes('"name": "ALPHA-0"')) {
    await replace(now, 0, '"name": "ALPHA-0"', '"name": "alpha-0"');
  }
  await probeUntil(
    hooks,
    title,
    'the undone edit in the panel',
    (p) => p.counter === `${differences} differences`,
  );
  return { ms };
}

exports.run = async function run() {
  const out = process.env.CHR_BENCH_OUT;
  const files = JSON.parse(process.env.CHR_BENCH_FILES ?? '[]');
  if (!out || !files.length) throw new Error('CHR_BENCH_OUT and CHR_BENCH_FILES must be set');

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not installed`);
  const hooks = (await extension.activate()).testHooks;
  if (!hooks || !hooks.compareLimit) {
    throw new Error('no compare test hooks: build the .vsix with CHR_TEST_HOOKS=1 pnpm package');
  }
  hooks.compareLimit(Number.MAX_SAFE_INTEGER, undefined);

  const results = {
    vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    runs: RUNS,
    sizes: [],
  };
  for (const file of files) {
    const left = vscode.Uri.file(file.path);
    const right = vscode.Uri.file(file.path.replace(/\.json$/, '-changed.json'));
    const name = (uri) => uri.path.slice(uri.path.lastIndexOf('/') + 1);
    const title = `${name(left)} ↔ ${name(right)}`;
    const records = recordCount(file.path);
    const differences = changedCount(records);
    const entry = { mib: file.mib, bytes: fs.statSync(file.path).size, records, differences };
    entry.open = [];
    entry.refresh = [];
    results.sizes.push(entry);
    console.log(`bench: compare ${file.mib} MiB, ${records} records, ${differences} differences`);
    for (let run = 0; run < RUNS; run++) {
      await closeAll();
      try {
        entry.open.push(await timeOpen(hooks, left, right, title, differences));
      } catch (error) {
        entry.open.push({ error: message(error) });
        // The other runs would fail the same way and each can cost the full timeout.
        break;
      }
      try {
        entry.refresh.push(await timeRefresh(hooks, right, title, differences));
      } catch (error) {
        entry.refresh.push({ error: message(error) });
      }
    }
    await closeAll();
    console.log(`bench: ${JSON.stringify(entry)}`);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
};
