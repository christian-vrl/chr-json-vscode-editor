// Writes bench/large-file.md (008 T5: spec 008 criterion 11, the evidence for UNK-041, plan R5 and
// R6) from the results bench/large-file.mjs left in <resultsDir>/large-file.json. Every number in
// the report comes from that file; the text around them says what each covers.
//
//   node bench/large-file-report.mjs <resultsDir> <out.md>
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [resultsDir, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/large-file-report.mjs <resultsDir> <out.md>');
  process.exit(2);
}
const results = JSON.parse(readFileSync(path.join(resultsDir, 'large-file.json'), 'utf8'));

// Spec 008 criterion 11: at 50 MiB, first render minus webview ready under 5 s for each format.
const RENDER_MIB = 50;
const RENDER_LIMIT_MS = 5000;
// UNK-041's evidence rule: one validation (data-only parse plus Ajv) under 1 s.
const VALIDATION_LIMIT_MS = 1000;
const FORMATS = ['json', 'jsonc', 'json5'];
// 015 T6 (UNK-068's evidence rule): the same files with every record's id a 19-digit big number.
const ID_FORMATS = FORMATS.map((format) => `${format}-ids`);
const LABELS = {
  json: 'JSON',
  jsonc: 'JSONC',
  json5: 'JSON5',
  'json-ids': 'JSON big ids',
  'jsonc-ids': 'JSONC big ids',
  'json5-ids': 'JSON5 big ids',
};
const MIB = 2 ** 20;

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value) => (value === undefined ? '—' : Math.round(value).toLocaleString('en-US'));
const mib = (bytes) => (bytes == null ? '—' : Math.round(bytes / MIB).toLocaleString('en-US'));
/** The values of `pick` over runs, or none if a run is missing. */
const values = (runs, pick) => (runs.length === results.runs ? runs.map(pick) : []);
const med = (runs, pick) => median(values(runs, pick));

/** "median (run1, run2, run3)", or why there is none. */
function cell(runs, pick, format = ms) {
  const all = values(runs, pick);
  if (!all.length) return `missing (${runs.length} of ${results.runs} runs; see Errors)`;
  return `**${format(median(all))}** (${all.map(format).join(', ')})`;
}

const files = results.files;
const sizes = [...new Set(files.map((f) => f.mib))].sort((a, b) => a - b);
const fileOf = (format, size) => files.find((f) => f.format === format && f.mib === size);
const extra = (o) => o.renderMs - o.readyMs;

const commit = process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const cpus = os.cpus();

const lines = [];
const add = (...l) => lines.push(...l);

add(
  '# Large-file mode benchmark (008 T5)',
  '',
  '> Evidence for spec 008 criterion 11, UNK-041 and plan risks R5 and R6, and for UNK-068 (spec 015 criterion 12). Written by',
  '> `bench/large-file-report.mjs` from one benchmark run (`bench/large-file.mjs`); do not edit by hand.',
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : 'local machine (not the CI runner)'}; commit \`${commit}\`.`,
  `- Machine: ${process.env.RUNNER_OS ?? os.type()} ${os.arch()} (\`${process.env.ImageOS ?? os.release()}\`), ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- VS Code ${results.vscodeVersion} (\`--disable-gpu\`, under xvfb), the e2e .vsix (release build plus test hooks). UNK-041's limit in that build: ${results.validationLimit.toLocaleString('en-US')} bytes.`,
  `- ${results.runs} runs per file; each cell is **median** (run 1, run 2, run 3), in milliseconds unless it says MiB. The editor is closed between runs, so every run opens the file again in the same VS Code window.`,
  '- Files: `node bench/generate.mjs --formats`, the same 7-field records as `bench/vscode-open.md` in one pretty-printed array, exactly N × 2^20 bytes, ASCII only: JSON; JSONC with a line comment above each record; JSON5 with unquoted keys, single-quoted strings and a trailing comma in each object. Every file is above the 5 MiB threshold, so it opens in large-file mode (locked).',
  "- Schema: `bench/large-file.schema.json` (draft-07: every record's fields, types, a zip pattern), associated through `json.schemas` (JSON, JSONC) and `json5.schemas` (JSON5) in user settings. Every file is valid against it.",
  '',
  '## Open',
  '',
  '| File | Webview ready | First render | Render minus ready | Host busy on open | badge | validation |',
  '|---|---|---|---|---|---|---|',
);
for (const size of sizes) {
  for (const format of FORMATS) {
    const f = fileOf(format, size);
    if (!f) continue;
    add(
      `| ${LABELS[format]} ${size} MiB | ${cell(f.open, (o) => o.readyMs)} | ${cell(f.open, (o) => o.renderMs)} | ${cell(f.open, extra)} | ${cell(f.busy, (b) => b.ms)} | ${cell(f.busy, (b) => b.badgeMs)} | ${cell(f.busy, (b) => b.validationMs)} |`,
    );
  }
}
add(
  '',
  "- **Webview ready:** from `vscode.openWith` until the webview script sends `ready` (VS Code reads the file, syncs it to the extension host, creates the webview, loads webview.js). On the extension host's clock.",
  '- **First render:** from the same start until the tree shows the root\'s "<n> items": the host sends the text (`init`), the webview parses it (`JSON.parse` for JSON, core\'s `parseData` for JSONC and JSON5) and the library renders the tree, read-only.',
  '- **Render minus ready:** the part our code adds on top of VS Code, per run, then the median.',
  "- **Host busy on open:** the extension host's own time on the tab's format badge and on schema validation, from the open until the webview showed the first validation result and 2.5 s more passed. Validation here is the `$schema` lookup, compiling the schema, the data-only parse, Ajv and posting the result; it runs once when the schema is bound and once more when the webview is ready (spec 004), and the second run parses again when the first parse is older than 2 s (`largeFile.ts` `dataOf`, 008 T3 review finding 2). The benchmark lifts UNK-041's limit so validation runs on open at every size: above the limit (below) only the badge's part stays.",
  '',
  `## Spec 008 criterion 11 (at ${RENDER_MIB} MiB, render minus ready < ${RENDER_LIMIT_MS.toLocaleString('en-US')} ms per format)`,
  '',
  '| Format | Render minus ready | Verdict |',
  '|---|---|---|',
);
let criterion11 = true;
for (const format of FORMATS) {
  const f = fileOf(format, RENDER_MIB);
  const value = f ? med(f.open, extra) : undefined;
  const pass = value !== undefined && value < RENDER_LIMIT_MS;
  criterion11 &&= pass;
  add(`| ${LABELS[format]} | ${ms(value)} | ${pass ? 'pass' : 'miss'} |`);
}
add('', `Criterion 11: **${criterion11 ? 'holds' : 'does not hold'}**.`, '');

const idFiles = files.filter((f) => ID_FORMATS.includes(f.format));
let idCriterion11;
if (idFiles.length) {
  add(
    '## UNK-068: big numbers on in large-file mode (spec 015 criterion 12)',
    '',
    "The same files with every record's `id` written as 19 digits (10^18 + i, a big number: `node bench/generate.mjs --formats --big-ids`), opened in large-file mode with big numbers kept exact (015 T6): the webview reads strict JSON with core's `readJsonExact` (lossless-json) and JSONC and JSON5 with core's `parseData`, every big id an `EditorNumber`. UNK-068's rule: in one CI run, spec 008 criterion 7 (in `bench/RESULTS.md`, same run) and criterion 11 below both pass with big numbers on.",
    '',
    '| File | Webview ready | First render | Render minus ready | Host busy on open | Webview heap (MiB) |',
    '|---|---|---|---|---|---|',
  );
  for (const size of sizes) {
    for (const format of ID_FORMATS) {
      const f = fileOf(format, size);
      if (!f) continue;
      add(
        `| ${LABELS[format]} ${size} MiB | ${cell(f.open, (o) => o.readyMs)} | ${cell(f.open, (o) => o.renderMs)} | ${cell(f.open, extra)} | ${cell(f.busy, (b) => b.ms)} | ${f.heap.some((h) => h.webview == null) ? 'not reported' : cell(f.heap, (h) => h.webview, mib)} |`,
      );
    }
  }
  add(
    '',
    `Spec 008 criterion 11 with big ids (at ${RENDER_MIB} MiB, render minus ready < ${RENDER_LIMIT_MS.toLocaleString('en-US')} ms per format):`,
    '',
    '| Format | Render minus ready | Without big ids | Verdict |',
    '|---|---|---|---|',
  );
  idCriterion11 = true;
  for (const format of ID_FORMATS) {
    const f = fileOf(format, RENDER_MIB);
    const plain = fileOf(format.replace(/-ids$/, ''), RENDER_MIB);
    const value = f ? med(f.open, extra) : undefined;
    const pass = value !== undefined && value < RENDER_LIMIT_MS;
    idCriterion11 &&= pass;
    add(
      `| ${LABELS[format]} | ${ms(value)} | ${ms(plain ? med(plain.open, extra) : undefined)} | ${pass ? 'pass' : 'miss'} |`,
    );
  }
  add('', `Criterion 11 with big ids: **${idCriterion11 ? 'holds' : 'does not hold'}**.`, '');
}

add(
  `## UNK-041: validation of one large file (< ${VALIDATION_LIMIT_MS.toLocaleString('en-US')} ms)`,
  '',
  "One validation from the text alone, as the paused item's click runs it: core's `parseData` plus Ajv, start to result posted, in the extension host (test hook `timeValidation`, which first drops the data `dataOf` keeps).",
  '',
  `| Size | ${FORMATS.map((f) => LABELS[f]).join(' | ')} | All under ${VALIDATION_LIMIT_MS.toLocaleString('en-US')} ms |`,
  `|---|${FORMATS.map(() => '---|').join('')}---|`,
);
let limitMib;
let broken = false;
let allValid = true;
for (const size of sizes) {
  const medians = FORMATS.map((format) => {
    const f = fileOf(format, size);
    if (f && values(f.validation, (v) => v.valid).includes(false)) allValid = false;
    return f ? med(f.validation, (v) => v.ms) : undefined;
  });
  const pass = medians.every((m) => m !== undefined && m < VALIDATION_LIMIT_MS);
  if (!pass) broken = true;
  else if (!broken) limitMib = size;
  add(
    `| ${size} MiB | ${FORMATS.map((format) => cell(fileOf(format, size)?.validation ?? [], (v) => v.ms)).join(' | ')} | ${pass ? 'yes' : 'no'} |`,
  );
}
const largest = sizes.at(-1);
add(
  '',
  'The rule reads "the largest size in `bench/large-file.md` where … the median of 3 runs … is < 1 s"; a size counts when it holds for JSON, JSONC and JSON5 alike, since the limit is one number for every format. Sizes count from the smallest up, so a size above one that fails does not count.',
  '',
  limitMib === undefined
    ? `Result: **no size passes**. Validation of a large file is paused at every size above the 5 MiB threshold: \`VALIDATION_LIMIT_BYTES\` = 5,242,880.`
    : limitMib === largest
      ? `Result: **${largest} MiB passes**, so validation always runs: \`VALIDATION_LIMIT_BYTES\` = ${(largest * MIB).toLocaleString('en-US')}${largest === RENDER_MIB ? " (VS Code's ceiling)" : ''}.`
      : `Result: **${limitMib} MiB** = ${(limitMib * MIB).toLocaleString('en-US')} bytes. Up to it a large file validates on open and on change; above it validation is paused and runs once per click on "Schema validation paused: large file".`,
  ...(allValid
    ? []
    : [
        '',
        '**Warning:** a validation reported errors; every file should be valid against the schema.',
      ]),
  '',
  `## Memory (plan R6)`,
  '',
  "JavaScript heap in use, in MiB, after the open and the timed validation: the extension host's (`process.memoryUsage().heapUsed`, shared with every other extension) and the webview's (Chromium's `performance.memory.usedJSHeapSize`).",
  '',
  '| File | Extension host | Webview |',
  '|---|---|---|',
);
for (const size of sizes) {
  for (const format of FORMATS) {
    const f = fileOf(format, size);
    if (!f) continue;
    add(
      `| ${LABELS[format]} ${size} MiB | ${cell(f.heap, (h) => h.host, mib)} | ${f.heap.some((h) => h.webview == null) ? 'not reported' : cell(f.heap, (h) => h.webview, mib)} |`,
    );
  }
}
add(
  '',
  `## "Edit anyway" at ${results.editMib} MiB (plan R5)`,
  '',
  `After each open at ${results.editMib} MiB: "Edit anyway", then one tree edit (a \`replace\` of the first record's \`name\`, test hook \`patch\`) timed as \`bench/vscode-open.md\` times it: on the webview's clock until the host's answer is in and the editor is free again. The host parses the whole text on this first edit (spec 003's path) and keeps that parse for the next one. Validation is paused, as above UNK-041's limit.`,
  '',
  '| Format | One edit | value shown | host applies it | Host heap after (MiB) |',
  '|---|---|---|---|---|',
);
for (const format of FORMATS) {
  const f = fileOf(format, results.editMib);
  if (!f) continue;
  add(
    `| ${LABELS[format]} | ${cell(f.edit, (e) => e.ms)} | ${cell(f.edit, (e) => e.shownMs)} | ${cell(f.edit, (e) => e.hostMs)} | ${cell(f.edit, (e) => e.hostHeap, mib)} |`,
  );
}
const errors = files.flatMap((f) =>
  f.errors.map((e) => `- ${LABELS[f.format]} ${f.mib} MiB, run ${e.run}: ${e.error}`),
);
add(
  '',
  '## Errors',
  '',
  ...(errors.length ? errors : ['None: every run of every file completed.']),
  '',
);
writeFileSync(out, lines.join('\n'));
console.log(`bench: wrote ${out}`);
