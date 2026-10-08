// Writes bench/RESULTS.md (002 T8, spec 002 criterion 7) from `bench/core/run.mjs`'s raw results.
// Every number in the report comes from that file; the text around them says what each one covers.
//
//   node bench/core/report.mjs <core.json> <out.md>
//
// The commit is BENCH_COMMIT (the workflow sets it to the pull request's head), else GITHUB_SHA,
// which on a pull_request run is GitHub's merge ref rather than the commit pushed.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const [resultsFile, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/core/report.mjs <core.json> <out.md>');
  process.exit(2);
}
const results = JSON.parse(readFileSync(resultsFile, 'utf8'));

// UNK-014's evidence rule for one edit; applyPatch is only the host's share of it.
const EDIT_LIMIT_MS = 500;
const OPS = ['replace', 'add', 'remove', 'move'];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value) => Math.round(value).toLocaleString('en-US');
const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);
const mib = (bytes) => Math.round(bytes / 2 ** 20).toLocaleString('en-US');
const cell = (runs) => `**${ms(median(runs))}** (${runs.map(ms).join(', ')})`;

const commit = process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const cpus = os.cpus();

const lines = [];
const add = (...l) => lines.push(...l);

add(
  '# Core benchmark: parse and one edit per format (002 T8)',
  '',
  '> Spec 002 criterion 7. Written by `bench/core/report.mjs` from one benchmark run; do not edit',
  '> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.',
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : 'local machine (not the CI runner)'}; commit \`${commit}\`.`,
  `- Machine: ${process.env.RUNNER_OS ?? os.type()} ${os.arch()} (\`${process.env.ImageOS ?? os.release()}\`), ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- Node ${results.node}, \`@chr-json-editor/core\` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (\`--expose-gc\`, heap collected before every timed call; \`--max-old-space-size=${results.heapMiB}\`, Node's default heap limit on this machine: ${gib(results.defaultHeapLimitBytes)} GiB, see Memory).`,
  `- ${results.runs} runs per cell after a warm-up on a 256 KiB document; each cell is **median** (run 1, run 2, run 3), in milliseconds.`,
  '',
  '## Files',
  '',
  'Each size is exactly N × 2^20 bytes (MiB, as in `bench/vscode-open.md`), ASCII only, one array of',
  'records padded inside the last record. Built in memory by `bench/core/run.mjs`:',
  '',
  '- **json:** `bench/generate.mjs`, the file 003 T11 opens in VS Code (pretty-printed, 2 spaces).',
  '- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a',
  '  trailing comma in each nested object and after the last record.',
  '- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas',
  '  after every last member.',
  '',
  'Records per file:',
  '',
  `| Size | ${results.formats.map((f) => f.format).join(' | ')} |`,
  `|---|${results.formats.map(() => '---|').join('')}`,
);
for (const [i, s] of results.formats[0].sizes.entries()) {
  add(
    `| ${s.mib} MiB (${s.bytes.toLocaleString('en-US')} B) | ${results.formats.map((f) => f.sizes[i].records.toLocaleString('en-US')).join(' | ')} |`,
  );
}

add(
  '',
  '## Results',
  '',
  '`parse` is `getAdapter(format).parse(text)` (data, tree, style, diagnostics). Each edit is one',
  '`applyPatch(text, [op])` on the middle record `m`, returning the whole new text:',
  '',
  '- **replace:** `{ op: "replace", path: "/m/name", value: "edited" }`, one string.',
  '- **add:** `{ op: "add", path: "/m/extra", value: { added: true } }`, a new key.',
  '- **remove:** `{ op: "remove", path: "/m" }`, a whole record with its comments.',
  '- **move:** `{ op: "move", from: "/m", path: "/-" }`, the record to the end; `move` re-parses',
  '  between its remove and its add (002 T6).',
);
for (const f of results.formats) {
  add(
    '',
    `### ${f.format}`,
    '',
    `| Size | parse | ${OPS.join(' | ')} |`,
    `|---|---|${OPS.map(() => '---|').join('')}`,
  );
  for (const s of f.sizes) {
    add(`| ${s.mib} MiB | ${cell(s.parse)} | ${OPS.map((op) => cell(s[op])).join(' | ')} |`);
  }
}

add(
  '',
  '## Memory',
  '',
  '**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive',
  'after a full collection, so what a host holding the parsed document pays. **Max RSS** is the',
  'peak resident memory of the measuring process over the whole cell (source text, every parse and',
  "edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)",
  'the first run of this benchmark ran out of heap in the json 50 MiB cell',
  '([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).',
  '',
  `| Size | ${results.formats.map((f) => `${f.format} retained heap | ${f.format} max RSS`).join(' | ')} |`,
  `|---|${results.formats.map(() => '---|---|').join('')}`,
);
for (const [i, s] of results.formats[0].sizes.entries()) {
  add(
    `| ${s.mib} MiB | ${results.formats.map((f) => `${mib(f.sizes[i].retainedHeapBytes)} | ${mib(f.sizes[i].maxRssBytes)}`).join(' | ')} |`,
  );
}

add(
  '',
  "## Against UNK-014's edit budget (< 500 ms)",
  '',
  'applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on',
  'top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;',
  'one under it is necessary, not sufficient.',
  '',
  `| Size | ${results.formats.map((f) => f.format).join(' | ')} |`,
  `|---|${results.formats.map(() => '---|').join('')}`,
);
for (const [i, s] of results.formats[0].sizes.entries()) {
  const row = results.formats.map((f) => {
    const slowest = Math.max(...OPS.map((op) => median(f.sizes[i][op])));
    return `${slowest < EDIT_LIMIT_MS ? 'within' : 'over'}, slowest op ${ms(slowest)}`;
  });
  add(`| ${s.mib} MiB | ${row.join(' | ')} |`);
}

add(
  '',
  'Medians relative to parse, over all sizes and formats (edit ÷ parse): ' +
    OPS.map((op) => {
      const ratios = results.formats.flatMap((f) =>
        f.sizes.map((s) => median(s[op]) / median(s.parse)),
      );
      return `${op} ${Math.min(...ratios).toFixed(1)}–${Math.max(...ratios).toFixed(1)}×`;
    }).join(', ') +
    '.',
  '',
  'Every `applyPatch` call parses the whole text again (tree and tokens) before it edits, and `move`',
  'parses twice, so edit time grows with file size like parse time does.',
  '',
  'To reproduce: `pnpm --filter @chr-json-editor/core build`, then',
  '`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).',
);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench core: wrote ${out}`);
