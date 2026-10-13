// Writes bench/RESULTS.md (002 T8, spec 002 criterion 7; 008 T1, spec 008 criterion 7; 010 T2,
// spec 010 criterion 11; 012 T2, spec 012 criterion 12; 011 T5, spec 011 criterion 12; 014 T4,
// spec 014 criterion 10) from
// `bench/core/run.mjs`'s raw results and, when given, `bench/query/run.mjs`'s.
// Every number in the report comes from that file; the text around them says what each one covers.
//
//   node bench/core/report.mjs <core.json> <out.md> [query.json]
//
// The commit is BENCH_COMMIT (the workflow sets it to the pull request's head), else GITHUB_SHA,
// which on a pull_request run is GitHub's merge ref rather than the commit pushed.
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const [resultsFile, out, queryFile] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/core/report.mjs <core.json> <out.md> [query.json]');
  process.exit(2);
}
const results = JSON.parse(readFileSync(resultsFile, 'utf8'));
const queries = queryFile ? JSON.parse(readFileSync(queryFile, 'utf8')) : undefined;

// Spec 011 criterion 12: above this at 5 MiB, an UNKNOWN goes to the owner.
const QUERY_LIMIT_MS = 2500;
// Spec 014 criterion 10: a JSONPath (RFC 9535) bench query over this at 5 MiB on the CI runner
// sends an UNKNOWN to the owner.
const JSONPATH_LIMIT_MS = 1000;

// UNK-014's evidence rule for one edit; applyPatch is only the host's share of it.
const EDIT_LIMIT_MS = 500;
const OPS = ['replace', 'add', 'remove', 'move'];
// Spec 008 criterion 7: parseData's median time and retained heap at most this share of parse's,
// for these formats and sizes.
const LIGHT_SHARE = 0.5;
const LIGHT_FORMATS = ['jsonc', 'json5'];
const LIGHT_SIZES = [10, 50];
// Spec 010 criterion 11's hypothesis: smart format's 5 MiB median under 5 s on the CI runner.
const SMART_LIMIT_MS = 5000;
const SMART_JUDGED_MIB = 5;
// Spec 012 criterion 12: parseData('jsonl') at most this many times parseData('json') on the array.
const LINES_FACTOR = 1.25;

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
  `> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11, spec 012 criterion 12${queries ? `, spec 011 criterion 12${queries.jsonpath ? ' and spec 014 criterion 10' : ''}` : ''}. Written by \`bench/core/report.mjs\` from one benchmark run; do not edit`,
  `> by hand. Re-run it (the \`bench\` workflow) whenever \`packages/core/src/formats\`${queries ? ' or `packages/app-shell/src/query`' : ''} changes speed.`,
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

if (queries) {
  const sizes = [...new Set(queries.results.map((r) => r.mib))];
  add(
    '',
    '## Spec 011 criterion 12: JavaScript and Lodash queries',
    '',
    'One run of each bench query in the engine (`runQuery` from `packages/app-shell/src/query`: a',
    'fresh QuickJS runtime and context, Lodash loaded for Lodash, the data copied in, the query, the',
    "result copied out) beside the reference (the library's own `executeQuery` of the same language,",
    'in Node, on the data already in memory, so it copies nothing). The documents are',
    "`bench/generate.mjs`'s JSON files at " +
      sizes.map((m) => `${m} MiB`).join(' and ') +
      `, parsed once. Same Node process, \`--expose-gc\`, heap collected before every timed call; ${queries.runs} runs per`,
    `cell after a warm-up on a 256 KiB document; each cell is **median** (runs), in milliseconds. The engine's`,
    `WebAssembly was compiled once before the runs (${ms(queries.compileMs)} ms; criterion 10 compiles it when Transform first opens).`,
    '',
    '- **filter-map** (JavaScript, `bench/query/filter-map.js`): `filter` on two fields, then `map` to',
    '  four.',
    '- **filter-orderBy-map** (Lodash, `bench/query/filter-orderBy-map.js`): `_.chain`, `filter`,',
    '  `orderBy` on two keys, `map` with `_.pick`, `.value()`.',
    '',
    '| Size | Query | Result items | Engine | Reference | Engine ÷ reference | Same result | Within 2.5 s |',
    '|---|---|---|---|---|---|---|---|',
  );
  let over = false;
  for (const r of queries.results) {
    const engine = median(r.engine);
    const judged = r.mib === 5;
    const within = engine <= QUERY_LIMIT_MS;
    if (judged && !within) over = true;
    add(
      `| ${r.mib} MiB | ${r.query} (${r.language === 'lodash' ? 'Lodash' : 'JavaScript'}) | ${r.items.toLocaleString('en-US')} | ${cell(r.engine)} | ${cell(r.reference)} | ${(engine / Math.max(median(r.reference), 0.1)).toFixed(0)}× | ${r.same ? 'yes' : '**no**'} | ${judged ? (within ? 'yes' : '**no**') : 'not judged'} |`,
    );
  }
  add(
    '',
    !queries.results.some((r) => r.mib === 5)
      ? 'Verdict: not judged (this run has no 5 MiB cell).'
      : over
        ? 'Verdict: **a bench query at 5 MiB takes more than 2.5 s**; criterion 12 asks for an owner UNKNOWN.'
        : 'Verdict: every bench query at 5 MiB takes at most 2.5 s in this run (criterion 12).',
    '',
    "The reference is V8 running the query on data already in memory; most of the engine's time is",
    'copying the data in and the result out (011 T1 REPORT §3), so the ratio says what the sealed engine',
    'costs, not how fast QuickJS runs the query itself.',
  );
}

if (queries?.jsonpath) {
  const sizes = [...new Set(queries.jsonpath.map((r) => r.mib))];
  const judgedRows = queries.jsonpath.filter((r) => r.mib === 5);
  const over = judgedRows.filter((r) => median(r.rfc9535) > JSONPATH_LIMIT_MS);
  add(
    '',
    '## Spec 014 criterion 10: JSONPath queries',
    '',
    'Each bench query in JSONPath (RFC 9535) (`executeJsonpathRfc9535` from',
    '`packages/app-shell/src/query/jsonpath-rfc9535.ts`: json-p3 2.3.2, as the Transform dialog runs it)',
    "beside JSONPath (Goessner) (the library's `jsonpathQueryLanguage.executeQuery`, jsonpath-plus), in",
    "the same Node process as the queries above, on the same data already in memory: `bench/generate.mjs`'s",
    'JSON files at ' +
      sizes.map((m) => `${m} MiB`).join(' and ') +
      `, parsed once. Heap collected before every timed call; ${queries.runs} runs per cell after a warm-up on a`,
    '256 KiB document; each cell is **median** (runs), in milliseconds. "Same result" compares the two',
    "languages' results with `isDeepStrictEqual`.",
    '',
    '- **jsonpath-filter** (`bench/query/jsonpath-filter.jsonpath`): a filter on two fields.',
    '- **jsonpath-descendant** (`bench/query/jsonpath-descendant.jsonpath`): a descendant search for',
    '  one key.',
    '- **jsonpath-match** (`bench/query/jsonpath-match.jsonpath`): a filter with `match`; Goessner has',
    '  no `match`, so its query is the same filter with an anchored script regular expression.',
    '- **jsonpath-pick** (`bench/query/jsonpath-pick.jsonpath`): one field of every record.',
    '',
    '| Size | Query | RFC 9535 query | Goessner query | Result items | RFC 9535 | Goessner | RFC 9535 ÷ Goessner | Same result | RFC 9535 within 1 s |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  const code = (text) => `\`${text.replaceAll('|', '\\|')}\``;
  for (const r of queries.jsonpath) {
    const rfc = median(r.rfc9535);
    const judged = r.mib === 5;
    add(
      `| ${r.mib} MiB | ${r.query} | ${code(r.rfc9535Query)} | ${code(r.goessnerQuery)} | ${r.items.toLocaleString('en-US')} | ${cell(r.rfc9535)} | ${cell(r.goessner)} | ${(rfc / Math.max(median(r.goessner), 0.1)).toFixed(1)}× | ${r.same ? 'yes' : '**no**'} | ${judged ? (rfc <= JSONPATH_LIMIT_MS ? 'yes' : '**no**') : 'not judged'} |`,
    );
  }
  add(
    '',
    judgedRows.length === 0
      ? 'Verdict: not judged (this run has no 5 MiB cell).'
      : !runUrl
        ? `Verdict: not judged (not the CI runner); at 5 MiB every JSONPath (RFC 9535) median is ${over.length ? '**not** ' : ''}at most ${ms(JSONPATH_LIMIT_MS)} ms on this machine.`
        : over.length
          ? `Verdict: **${over.map((r) => r.query).join(', ')} at 5 MiB take${over.length === 1 ? 's' : ''} more than 1 s in JSONPath (RFC 9535)**; criterion 10 asks for an owner UNKNOWN before 014 T4 merges.`
          : 'Verdict: every JSONPath (RFC 9535) bench query at 5 MiB takes at most 1 s in this run (criterion 10).',
  );
}

add(
  '',
  '## Spec 010 criterion 11: smart format',
  '',
  '`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside',
  "Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB",
  'threshold above which smart format is off (criterion 10). Each call parses the text it formats.',
  `HYPOTHESIS: the 5 MiB median is under ${ms(SMART_LIMIT_MS)} ms on the CI runner.`,
  '',
  '| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |',
  '|---|---|---|---|---|---|',
);
let smartMissed = false;
for (const f of results.smart ?? []) {
  for (const s of f.sizes) {
    const share = median(s.smartFormat) / median(s.prettyPrint);
    if (s.mib === SMART_JUDGED_MIB && median(s.smartFormat) >= SMART_LIMIT_MS) smartMissed = true;
    add(
      `| ${f.format} | ${s.mib} MiB | ${cell(s.smartFormat)} | ${cell(s.prettyPrint)} | ${share.toFixed(1)}× | ${(s.smartBytes / 2 ** 20).toFixed(2)} MiB |`,
    );
  }
}
add(
  '',
  !results.smart
    ? 'Verdict: not measured in this run.'
    : !runUrl
      ? `Verdict: not judged (not the CI runner); the 5 MiB medians are ${smartMissed ? '**not** ' : ''}under ${ms(SMART_LIMIT_MS)} ms on this machine.`
      : smartMissed
        ? `Verdict: **the hypothesis does not hold**: a 5 MiB median is ${ms(SMART_LIMIT_MS)} ms or more, so an UNKNOWN goes to the owner (criterion 11).`
        : `Verdict: the hypothesis holds in this run (every 5 MiB median is under ${ms(SMART_LIMIT_MS)} ms).`,
);

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
  '`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`),',
  'which also runs the query benchmarks (`bench/query/run.mjs`).',
);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench core: wrote ${out}`);
