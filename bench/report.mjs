// Writes bench/vscode-open.md (003 T11, evidence for UNK-014) from the results bench/run.mjs left in
// <resultsDir>: vscode.json and, when the unminified build was timed too, vscode-unminified.json and
// webview.unminified.js. Every number in the report comes from those files; the text around them
// says what each one covers.
//
//   node bench/report.mjs <resultsDir> <out.md>
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [resultsDir, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/report.mjs <resultsDir> <out.md>');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8'));
const vscode = read('vscode.json');
const unminified = existsSync(path.join(resultsDir, 'vscode-unminified.json'))
  ? read('vscode-unminified.json')
  : undefined;

// UNK-014's evidence rule.
const OPEN_LIMIT_MS = 3000;
const EDIT_LIMIT_MS = 500;
// The run before 003 T5 that found VS Code's 50 MB limit (previous bench/vscode-open.md).
const LIMIT_RUN =
  'https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412';

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value) => (value === undefined ? '—' : Math.round(value).toLocaleString('en-US'));
const kb = (bytes) => `${Math.round(bytes / 1024).toLocaleString('en-US')} KiB`;
const ok = (runs) => runs.length > 0 && !runs.some((r) => r.error);
const med = (runs, key) => (ok(runs) ? median(runs.map((r) => r[key])) : undefined);

/** "median (run1, run2, run3)" in ms, or a pointer to the recorded error. */
function cell(runs, key) {
  if (!runs.length) return 'not run';
  if (!ok(runs)) return 'fails (see Errors below)';
  const values = runs.map((r) => r[key]);
  return `**${ms(median(values))}** (${values.map(ms).join(', ')})`;
}

const commit = process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const cpus = os.cpus();

const lines = [];
const add = (...l) => lines.push(...l);

add(
  '# Large-file benchmark: open, first render, one edit (003 T11)',
  '',
  '> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.',
  "> Measured end to end in the custom editor's webview (after 003 T5).",
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : 'local machine (not the CI runner)'}; commit \`${commit}\`.`,
  `- Machine: ${process.env.RUNNER_OS ?? os.type()} ${os.arch()} (\`${process.env.ImageOS ?? os.release()}\`), ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- VS Code ${vscode.vscodeVersion} (stable at run time, \`--disable-gpu\`, under xvfb), the e2e .vsix (release build plus test hooks).`,
  `- ${vscode.runs} runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds on the extension host's clock. The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.`,
  "- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.",
  `- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](${LIMIT_RUN})).`,
  '',
  '## Results',
  '',
  '| Size | Webview ready | First render | One edit | of which host | of which webview |',
  '|---|---|---|---|---|---|',
);
for (const s of vscode.sizes) {
  add(
    `| ${s.mib} MiB (${s.bytes.toLocaleString('en-US')} B) | ${cell(s.open, 'readyMs')} | ${cell(s.open, 'renderMs')} | ${cell(s.edit, 'ms')} | ${cell(s.edit, 'hostMs')} | ${cell(s.edit, 'viewMs')} |`,
  );
}

add(
  '',
  "## Against UNK-014's rule (open < 3 s, one edit < 500 ms)",
  '',
  '"Open" is the first render: the time until the user sees the document in the tree.',
  '',
  '| Size | First render | One edit | Verdict |',
  '|---|---|---|---|',
);
const passing = [];
for (const s of vscode.sizes) {
  const render = med(s.open, 'renderMs');
  const edit = med(s.edit, 'ms');
  const renderOk = render !== undefined && render < OPEN_LIMIT_MS;
  const editOk = edit !== undefined && edit < EDIT_LIMIT_MS;
  if (renderOk && editOk) passing.push(s.mib);
  const why = [
    render === undefined ? 'cannot open' : renderOk ? undefined : 'open too slow',
    edit === undefined ? 'no edit measured' : editOk ? undefined : 'edit too slow',
  ].filter(Boolean);
  add(
    `| ${s.mib} MiB | ${ms(render)} | ${ms(edit)} | ${why.length ? `miss: ${why.join(', ')}` : 'pass'} |`,
  );
}
add(
  '',
  passing.length
    ? `Largest size that passes: **${Math.max(...passing)} MiB**.`
    : `**No measured size passes**, not even ${Math.min(...vscode.sizes.map((s) => s.mib))} MiB.`,
);

if (unminified) {
  const minifiedJs = path.join(here, '../packages/vscode-extension/dist/webview.js');
  const unminifiedJs = path.join(resultsDir, 'webview.unminified.js');
  const one = (results) => results.sizes.find((s) => s.mib === 1);
  const rows = [
    ['minified (shipped)', minifiedJs, one(vscode)],
    ['unminified', unminifiedJs, one(unminified)],
  ];
  add(
    '',
    '## webview.js, minified and not (1 MiB)',
    '',
    '| Build | webview.js | Webview ready | First render |',
    '|---|---|---|---|',
    ...rows.map(
      ([name, file, s]) =>
        `| ${name} | ${existsSync(file) ? kb(statSync(file).size) : '—'} | ${s ? cell(s.open, 'readyMs') : 'not run'} | ${s ? cell(s.open, 'renderMs') : 'not run'} |`,
    ),
  );
}

add(
  '',
  '## What is measured',
  '',
  '- **Webview ready:** from `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview script',
  '  sends `ready`. Covers VS Code reading the file, syncing it to the extension host, creating the',
  '  webview and loading webview.js.',
  '- **First render:** from the same start until the tree shows the root\'s "<n> items" tag. On top of',
  "  ready: the host sends the text (`init`), the webview parses it with `core` (the library's",
  '  `parser` prop, criterion 10) and the library renders the tree.',
  "- **One edit:** a `replace` of the first record's `name`, sent down the webview's edit path (test",
  '  hook `patch`: the same `edit` message a tree edit sends, without the click and typing). Timed until',
  '  the tree shows the new value. **Host:** until the document changed: the message, `core`',
  '  applyPatch (which parses the whole text) and the WorkspaceEdit. **Webview:** the rest: the',
  '  `update` message with the full text, `core` parsing it again in the webview, and the render.',
  '',
  'To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter',
  '@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).',
);

const failures = [unminified, vscode]
  .filter(Boolean)
  .flatMap((results) => results.sizes)
  .flatMap((s) =>
    [...s.open, ...s.edit]
      .filter((r) => r.error)
      .map((r) => `- ${s.mib} MiB: ${r.error.replace(/\s+/g, ' ')}`),
  );
if (failures.length) add('', '## Errors, as recorded', '', ...failures);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench: wrote ${out}`);
