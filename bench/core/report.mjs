// Writes bench/RESULTS.md (002 T8, spec 002 criterion 7; 008 T1, spec 008 criterion 7; 012 T2, spec
// 012 criterion 12; 015 T2, spec 015 criterion 11's core part) from
// `bench/core/run.mjs`'s raw results, and from the base commit's when given (`<base.json>`, the
// same runner measuring the base commit's core build in the same job).
// Every number in the report comes from that file; the text around them says what each one covers.
//
//   node bench/core/report.mjs <core.json> <out.md> [base.json]
//
// The commit is BENCH_COMMIT (the workflow sets it to the pull request's head), else GITHUB_SHA,
// which on a pull_request run is GitHub's merge ref rather than the commit pushed.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const [resultsFile, out, baseFile] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/core/report.mjs <core.json> <out.md> [base.json]');
  process.exit(2);
}
const results = JSON.parse(readFileSync(resultsFile, 'utf8'));
const base = baseFile ? JSON.parse(readFileSync(baseFile, 'utf8')) : undefined;

// UNK-014's evidence rule for one edit; applyPatch is only the host's share of it.
const EDIT_LIMIT_MS = 500;
const OPS = ['replace', 'add', 'remove', 'move'];
// Spec 008 criterion 7: parseData's median time and retained heap at most this share of parse's,
// for these formats and sizes.
const LIGHT_SHARE = 0.5;
const LIGHT_FORMATS = ['jsonc', 'json5'];
const LIGHT_SIZES = [10, 50];
// Spec 012 criterion 12: parseData('jsonl') at most this many times parseData('json') on the array.
const LINES_FACTOR = 1.25;
// Spec 015 criterion 11: parse of each format at this size at most this many times the base
// commit's, in the same run.
const BASE_FACTOR = 1.1;
const BASE_SIZE = 10;

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
  '> Spec 002 criterion 7, spec 008 criterion 7, spec 012 criterion 12 and spec 015 criterion 11 (core part). Written by `bench/core/report.mjs` from one benchmark run; do not edit',
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
  "- **json-ids:** the json file with each record's `id` written as 19 digits (10^18 + i), a big",
  '  number (spec 015), parsed as json; the padding keeps the size exact.',
  '- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a',
  '  trailing comma in each nested object and after the last record.',
  '- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas',
  '  after every last member.',
  '- **jsonl:** `bench/generate.mjs` `linesText`, the same records as JSON Lines: one',
  '  `JSON.stringify(record)` per line, each ended by `\\n`.',
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
  '`parse` is `getAdapter(format).parse(text)` (data, tree, style, diagnostics); `parseData` is',
  '`parseData(format, text)` (the data alone, nothing cached; 008 T1). Each edit is one',
  '`applyPatch(text, [op])` on the middle record `m`, returning the whole new text, on a text core',
  'has not parsed yet (core keeps the parse of the last text per format, so this is the first edit',
  "of a text nothing else parsed). The second table is the extension host's usual case: the text",
  'was parsed already (format badge, schema validation, the previous edit).',
  '',
  '- **replace:** `{ op: "replace", path: "/m/name", value: "edited" }`, one string.',
  '- **add:** `{ op: "add", path: "/m/extra", value: { added: true } }`, a new key.',
  '- **remove:** `{ op: "remove", path: "/m" }`, a whole record with its comments.',
  '- **move:** `{ op: "move", from: "/m", path: "/-" }`, the record to the end; between its remove',
  '  and its add, `move` shifts the tree and tokens it has rather than parsing again (UNK-014).',
  '',
  'In jsonl, replace and add edit the one line of record `m` (L7), remove and move are whole-line',
  'edits (L4, L6).',
);
for (const f of results.formats) {
  add(
    '',
    `### ${f.format}`,
    '',
    `| Size | parse | parseData | ${OPS.join(' | ')} |`,
    `|---|---|---|${OPS.map(() => '---|').join('')}`,
  );
  for (const s of f.sizes) {
    add(
      `| ${s.mib} MiB | ${cell(s.parse)} | ${cell(s.parseData)} | ${OPS.map((op) => cell(s[op])).join(' | ')} |`,
    );
  }
  add(
    '',
    `After the text was parsed (${f.format}):`,
    '',
    `| Size | ${OPS.join(' | ')} |`,
    `|---|${OPS.map(() => '---|').join('')}`,
  );
  for (const s of f.sizes) {
    add(`| ${s.mib} MiB | ${OPS.map((op) => cell(s[`${op}Parsed`])).join(' | ')} |`);
  }
}

add(
  '',
  '## Memory',
  '',
  '**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive',
  'after a full collection, so what a host holding the parsed document pays; **parseData heap** is',
  "the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the",
  'peak resident memory of the measuring process over the whole cell (source text, every parse and',
  "edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)",
  'the first run of this benchmark ran out of heap in the json 50 MiB cell',
  '([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).',
  '',
  `| Size | ${results.formats.map((f) => `${f.format} retained heap | ${f.format} parseData heap | ${f.format} max RSS`).join(' | ')} |`,
  `|---|${results.formats.map(() => '---|---|---|').join('')}`,
);
for (const [i, s] of results.formats[0].sizes.entries()) {
  add(
    `| ${s.mib} MiB | ${results.formats.map((f) => `${mib(f.sizes[i].retainedHeapBytes)} | ${mib(f.sizes[i].parseDataRetainedHeapBytes)} | ${mib(f.sizes[i].maxRssBytes)}`).join(' | ')} |`,
  );
}

add(
  '',
  '## Spec 008 criterion 7: parseData against parse',
  '',
  `For jsonc and json5 at 10 and 50 MiB, \`parseData\`'s median time and its retained heap must each be`,
  `at most ${LIGHT_SHARE * 100}% of \`parse\`'s, in this run. json takes \`JSON.parse\`, so it is shown but not judged.`,
  '',
  '| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |',
  '|---|---|---|---|---|',
);
const pct = (share) => `${Math.round(share * 100)}%`;
let lightFailed = false;
for (const f of results.formats) {
  for (const s of f.sizes) {
    const time = median(s.parseData) / median(s.parse);
    const heap = s.parseDataRetainedHeapBytes / s.retainedHeapBytes;
    const judged = LIGHT_FORMATS.includes(f.format) && LIGHT_SIZES.includes(s.mib);
    const ok = time <= LIGHT_SHARE && heap <= LIGHT_SHARE;
    if (judged && !ok) lightFailed = true;
    add(
      `| ${f.format} | ${s.mib} MiB | ${pct(time)} (${ms(median(s.parseData))} ÷ ${ms(median(s.parse))} ms) | ${pct(heap)} (${mib(s.parseDataRetainedHeapBytes)} ÷ ${mib(s.retainedHeapBytes)} MiB) | ${judged ? (ok ? 'pass' : '**fail**') : 'not judged'} |`,
    );
  }
}
const judgedCells = results.formats.some(
  (f) => LIGHT_FORMATS.includes(f.format) && f.sizes.some((s) => LIGHT_SIZES.includes(s.mib)),
);
add(
  '',
  !judgedCells
    ? 'Verdict: not judged (this run has none of the judged cells).'
    : lightFailed
      ? 'Verdict: **criterion 7 does not hold** in this run.'
      : 'Verdict: criterion 7 holds in this run.',
);

const jsonl = results.formats.find((f) => f.format === 'jsonl');
if (jsonl) {
  add(
    '',
    '## Spec 012 criterion 12: JSON Lines against one JSON array',
    '',
    `\`parseData('jsonl')\` at 50 MiB must take a median time at most ${LINES_FACTOR} times that of`,
    "`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,",
    '`]`), in this run.',
    '',
    "| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |",
    '|---|---|---|---|---|',
  );
  let linesFailed = false;
  for (const s of jsonl.sizes) {
    const ratio = median(s.parseData) / median(s.parseDataArray);
    const ok = ratio <= LINES_FACTOR;
    const judged = s.mib === 50;
    if (judged && !ok) linesFailed = true;
    add(
      `| ${s.mib} MiB | ${cell(s.parseData)} | ${cell(s.parseDataArray)} | ${ratio.toFixed(2)} | ${judged ? (ok ? 'pass' : '**fail**') : 'not judged'} |`,
    );
  }
  add(
    '',
    !jsonl.sizes.some((s) => s.mib === 50)
      ? 'Verdict: not judged (this run has no 50 MiB cell).'
      : linesFailed
        ? 'Verdict: **criterion 12 does not hold** in this run.'
        : 'Verdict: criterion 12 holds in this run.',
  );
}

if (base) {
  add(
    '',
    '## Spec 015 criterion 11 (core part): parse against the base commit',
    '',
    `\`parse\` of each format at ${BASE_SIZE} MiB must take a median time at most ${BASE_FACTOR} times that of the`,
    `base commit's core (\`${base.commit ?? 'unknown'}\`), built and measured in the same job on the same runner.`,
    'json-ids is new with spec 015, so the base commit parses it with rounded ids; it is shown, not judged.',
    '',
    '| Format | parse (this commit) | parse (base) | this ÷ base | Result |',
    '|---|---|---|---|---|',
  );
  let baseFailed = false;
  let judgedAny = false;
  for (const f of results.formats) {
    const s = f.sizes.find((x) => x.mib === BASE_SIZE);
    const b = base.formats
      .find((x) => x.format === f.format)
      ?.sizes.find((x) => x.mib === BASE_SIZE);
    if (!s || !b) continue;
    const ratio = median(s.parse) / median(b.parse);
    const judged = f.format !== 'json-ids';
    const ok = ratio <= BASE_FACTOR;
    if (judged) judgedAny = true;
    if (judged && !ok) baseFailed = true;
    add(
      `| ${f.format} | ${cell(s.parse)} | ${cell(b.parse)} | ${ratio.toFixed(2)} | ${judged ? (ok ? 'pass' : '**fail**') : 'not judged'} |`,
    );
  }
  add(
    '',
    !judgedAny
      ? `Verdict: not judged (this run has no ${BASE_SIZE} MiB cell on both commits).`
      : baseFailed
        ? 'Verdict: **criterion 11 (core part) does not hold** in this run.'
        : 'Verdict: criterion 11 (core part) holds in this run.',
  );
}

add(
  '',
  "## Against UNK-014's edit budget (< 500 ms)",
  '',
  'applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on',
  'top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;',
  "one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.",
  '',
  `| Size | ${results.formats.map((f) => f.format).join(' | ')} |`,
  `|---|${results.formats.map(() => '---|').join('')}`,
);
for (const [i, s] of results.formats[0].sizes.entries()) {
  const row = results.formats.map((f) => {
    const slowest = Math.max(...OPS.map((op) => median(f.sizes[i][`${op}Parsed`])));
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
  'An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its',
  'time grows with file size like parse time does. On a parsed text, replace, add and remove only',
  'compute the change and write the new text; move also shifts the tree and tokens after the',
  'removed record.',
  '',
  'To reproduce: `pnpm --filter @chr-json-editor/core build`, then',
  '`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).',
);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench core: wrote ${out}`);
