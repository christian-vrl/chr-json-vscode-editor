// Writes bench/compare.md (007 T5, evidence for UNK-037) from the results bench/compare.mjs left
// in <resultsDir>: compare-core.json (bench/core/compare.mjs) and compare-vscode.json
// (bench/vscode/compare-suite.cjs). Every number in the report comes from those files; the text
// around them says what each one covers.
//
//   node bench/compare-report.mjs <resultsDir> <out.md>
//
// The commit is BENCH_COMMIT (the workflow sets it to the pull request's head), else GITHUB_SHA.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [resultsDir, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/compare-report.mjs <resultsDir> <out.md>');
  process.exit(2);
}
const read = (file) => JSON.parse(readFileSync(path.join(resultsDir, file), 'utf8'));
const core = read('compare-core.json');
const vscode = read('compare-vscode.json');

// UNK-037's evidence rule.
const OPEN_LIMIT_MS = 3000;
const REFRESH_LIMIT_MS = 1000;

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value) => (value === undefined ? '—' : Math.round(value).toLocaleString('en-US'));
const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);
const ok = (runs) => runs.length > 0 && !runs.some((r) => typeof r === 'object' && r.error);
const values = (runs, key) => runs.map((r) => (key ? r[key] : r));
const med = (runs, key) => (ok(runs) ? median(values(runs, key)) : undefined);

/** "median (run1, run2, run3)" in ms, or a pointer to the recorded error. */
function cell(runs, key) {
  if (!runs.length) return 'not run';
  if (!ok(runs)) return 'fails (see Errors below)';
  const v = values(runs, key);
  return `**${ms(median(v))}** (${v.map(ms).join(', ')})`;
}

/** Whether a size meets UNK-037's rule: 3 runs, open median < 3 s, refresh median < 1 s. */
function passes(s) {
  const open = med(s.open, 'ms');
  const refresh = med(s.refresh, 'ms');
  return (
    s.open.length === vscode.runs &&
    s.refresh.length === vscode.runs &&
    open !== undefined &&
    refresh !== undefined &&
    open < OPEN_LIMIT_MS &&
    refresh < REFRESH_LIMIT_MS
  );
}

const commit = process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const cpus = os.cpus();
const passing = vscode.sizes.filter(passes).map((s) => s.mib);
const limit = passing.length ? Math.max(...passing) : undefined;

const lines = [];
const add = (...l) => lines.push(...l);

add(
  '# Compare benchmark: structural compare at 1, 5, 10 and 50 MiB (007 T5)',
  '',
  '> Evidence for UNK-037 (spec 007 criterion 10). Written by `bench/compare-report.mjs` from one',
  '> benchmark run; do not edit by hand. Re-run it (the `bench` workflow, job `compare`) whenever',
  '> the compare panel, `compare` or `diff` changes speed.',
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : '**local machine, not the CI runner**'}; commit \`${commit}\`.`,
  `- Machine: ${process.env.RUNNER_OS ?? os.type()} ${os.arch()} (\`${process.env.ImageOS ?? os.release()}\`), ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- VS Code ${vscode.vscodeVersion} (${vscode.platform}) with the e2e .vsix; Node ${core.node} for the core part.`,
  `- ${vscode.runs} runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds. Run 1 of each size is the first compare of those files in the VS Code launch.`,
  '',
  '## Files',
  '',
  'Left: `node bench/generate.mjs`, the file 003 T11 opens (one pretty-printed array of 7-field',
  'records, exactly N × 2^20 bytes, ASCII only). Right: `node bench/generate.mjs --changed`, the',
  'same document with every 100th record’s name in capitals (about 1% of the records changed, same',
  'length), so `compare` reports one `changed` difference per changed record. Neither file is open in',
  'an editor when the compare starts.',
  '',
  '| Size | Bytes per side | Records | Differences |',
  '|---|---|---|---|',
  ...vscode.sizes.map(
    (s) =>
      `| ${s.mib} MiB | ${s.bytes.toLocaleString('en-US')} | ${s.records.toLocaleString('en-US')} | ${s.differences.toLocaleString('en-US')} |`,
  ),
  '',
  '## Compare panel in VS Code (UNK-037’s rule)',
  '',
  '- **Open:** from running "Compare Selected" on the two files until the compare page shows both',
  '  trees with the differences marked (each side’s root carries `chr-diff-inside`) and its counter',
  '  reads "<n> differences": the host reads and parses both documents and runs `compare`, the page',
  '  receives both texts, parses them and renders. **Posted** is the share until the host has posted',
  '  the compare to the page.',
  '- **Refresh:** one live refresh (criterion 7), from a `WorkspaceEdit` on the right document (one',
  '  more record’s name in capitals) until the page’s counter shows one difference more. It includes',
  '  the panel’s 100 ms pause after a change.',
  `- **Rule (UNK-037):** open median < ${ms(OPEN_LIMIT_MS)} ms and refresh median < ${ms(REFRESH_LIMIT_MS)} ms; the limit is the largest size that meets both.`,
  '',
  '| Size | Open | Posted | Refresh | Meets the rule |',
  '|---|---|---|---|---|',
  ...vscode.sizes.map(
    (s) =>
      `| ${s.mib} MiB | ${cell(s.open, 'ms')} | ${cell(s.open, 'postedMs')} | ${cell(s.refresh, 'ms')} | ${passes(s) ? 'yes' : 'no'} |`,
  ),
  '',
  limit === undefined
    ? '**No size meets the rule** on this run.'
    : `**Largest size that meets the rule on this run: ${limit} MiB.**`,
  '',
  '## Core alone (the host’s share, in Node)',
  '',
  '- **Parse both:** both sides parsed as the panel parses a strict JSON side (`JSON.parse`).',
  '- **`compare`:** `compare(left, right)` alone (plan 007 R3).',
  '- **Copy:** one difference (the middle one) copied from right into left as "Copy to left" does:',
  '  `copyDifference` and the json adapter’s `applyPatch` on a left text core has not parsed yet (the',
  '  panel parses strict JSON with `JSON.parse`, so core holds no parse of it). **`copyDifference`**',
  '  is its share alone (plan 007 R6).',
  `- Each size in its own Node process (\`--expose-gc\`, \`--max-old-space-size=${core.heapMiB}\`), after a warm-up on a 256 KiB pair.`,
  '',
  '| Size | Parse both | `compare` | Copy | `copyDifference` | Peak RSS (GiB) |',
  '|---|---|---|---|---|---|',
  ...core.sizes.map(
    (s) =>
      `| ${s.mib} MiB | ${cell(s.parse)} | ${cell(s.compare)} | ${cell(s.copy)} | ${cell(s.copyPatch)} | ${gib(s.maxRssBytes)} |`,
  ),
  '',
);

const errors = vscode.sizes.flatMap((s) =>
  [...s.open, ...s.refresh].filter((r) => r.error).map((r) => `- ${s.mib} MiB: ${r.error}`),
);
if (errors.length) add('## Errors', '', ...errors, '');

writeFileSync(out, lines.join('\n'));
console.log(`bench: wrote ${out}`);
