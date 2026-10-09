// Writes bench/vscode-open.md (003 T11, evidence for UNK-014) from the results bench/run.mjs left in
// <resultsDir>: vscode.json and, when 1 MiB was timed in a second VS Code launch, vscode-second.json.
// Every number in the report comes from those files; the text around them says what each covers.
//
//   node bench/report.mjs <resultsDir> <out.md>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [resultsDir, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/report.mjs <resultsDir> <out.md>');
  process.exit(2);
}
const read = (file) => JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8'));
const vscode = read('vscode.json');
const second = existsSync(path.join(resultsDir, 'vscode-second.json'))
  ? read('vscode-second.json')
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
const ok = (runs) => runs.length > 0 && !runs.some((r) => r.error);
/** The runs of `key` in a size; results from before the second edit was timed have none. */
const runsOf = (s, key) => s[key] ?? [];
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
  `- ${vscode.runs} runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds (the edit on the webview's clock, the rest on the extension host's). The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.`,
  "- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.",
  `- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](${LIMIT_RUN})).`,
  '',
  '## Results',
  '',
  '| Size | Webview ready | First render | One edit | value shown | host applies it | Second edit |',
  '|---|---|---|---|---|---|---|',
);
for (const s of vscode.sizes) {
  add(
    `| ${s.mib} MiB (${s.bytes.toLocaleString('en-US')} B) | ${cell(s.open, 'readyMs')} | ${cell(s.open, 'renderMs')} | ${cell(s.edit, 'ms')} | ${cell(s.edit, 'shownMs')} | ${cell(s.edit, 'hostMs')} | ${cell(runsOf(s, 'second'), 'ms')} |`,
  );
}

add(
  '',
  "## Against UNK-014's rule (open < 3 s, one edit < 500 ms)",
  '',
  '"Open" is the first render: the time until the user sees the document in the tree.',
  '',
  'Both edits count: the slower median of the first and the second edit must be under 500 ms.',
  '',
  '| Size | First render | One edit | Second edit | Verdict |',
  '|---|---|---|---|---|',
);
const passing = [];
for (const s of vscode.sizes) {
  const render = med(s.open, 'renderMs');
  const first = med(s.edit, 'ms');
  const second = med(runsOf(s, 'second'), 'ms');
  const edit =
    first === undefined || (runsOf(s, 'second').length && second === undefined)
      ? undefined
      : Math.max(first, second ?? first);
  const renderOk = render !== undefined && render < OPEN_LIMIT_MS;
  const editOk = edit !== undefined && edit < EDIT_LIMIT_MS;
  if (renderOk && editOk) passing.push(s.mib);
  const why = [
    render === undefined ? 'cannot open' : renderOk ? undefined : 'open too slow',
    edit === undefined ? 'no edit measured' : editOk ? undefined : 'edit too slow',
  ].filter(Boolean);
  add(
    `| ${s.mib} MiB | ${ms(render)} | ${ms(first)} | ${ms(second)} | ${why.length ? `miss: ${why.join(', ')}` : 'pass'} |`,
  );
}
add(
  '',
  passing.length
    ? `Largest size that passes: **${Math.max(...passing)} MiB**.`
    : `**No measured size passes**, not even ${Math.min(...vscode.sizes.map((s) => s.mib))} MiB.`,
);

if (second) {
  const rows = second.sizes.map(
    (s) =>
      `| ${s.mib} MiB | ${cell(s.open, 'readyMs')} | ${cell(s.open, 'renderMs')} | ${cell(s.edit, 'ms')} | ${cell(s.edit, 'shownMs')} | ${cell(runsOf(s, 'second'), 'ms')} |`,
  );
  add(
    '',
    '## The same in a second VS Code launch',
    '',
    "Timed again after the first launch closed, on the same runner: how far one launch's medians",
    'can move. The verdict above uses the first launch.',
    '',
    '| Size | Webview ready | First render | One edit | value shown | Second edit |',
    '|---|---|---|---|---|---|',
    ...rows,
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
  "  ready: the host sends the text (`init`), the webview parses it (the library's `parser` prop,",
  '  criterion 10: `JSON.parse` for strict JSON, else `core`) and the library renders the tree.',
  "- **One edit:** a `replace` of the first record's `name`, made down the webview's edit path (test",
  '  hook `patch`: the library applies it, as a tree edit does, and the same `edit` message goes to',
  "  the host, without the click and typing). Timed on the webview's clock, where the edit starts,",
  "  until the host's answer is in and the editor is free again: nothing in flight, the document",
  '  shown. The answer carries the whole new text; the webview keeps the data it already shows.',
  '  **Value shown:** until the tree shows the new value, which it does before the host answers.',
  "  **Host applies it:** on the host's clock, from sending the patch until the document changed:",
  '  the message, `core` applyPatch and the WorkspaceEdit. After the change the host parses the new',
  '  text once in the background (format badge, schema validation, the next edit), which can delay',
  '  an edit made right after.',
  '- **Second edit:** the same edit with another value, made as soon as the first settled: the host',
  '  now edits the text its first edit produced, not the one it parsed on open. Run 1 of each size',
  '  is the first open of that file in this VS Code launch (cold); runs 2 and 3 open it again.',
  '',
  'To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter',
  '@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).',
);

const failures = [vscode, second]
  .filter(Boolean)
  .flatMap((results) => results.sizes)
  .flatMap((s) =>
    [...s.open, ...s.edit, ...runsOf(s, 'second')]
      .filter((r) => r.error)
      .map((r) => `- ${s.mib} MiB: ${r.error.replace(/\s+/g, ' ')}`),
  );
if (failures.length) add('', '## Errors, as recorded', '', ...failures);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench: wrote ${out}`);
