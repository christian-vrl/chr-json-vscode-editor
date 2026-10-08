// Writes bench/vscode-open.md (003 T11, evidence for UNK-014) from the two result files. Every
// number in the report comes from those files; the text around them says what each one covers.
//
//   node bench/report.mjs <vscode.json> <web.json> <out.md>
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const [vscodeFile, webFile, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/report.mjs <vscode.json> <web.json> <out.md>');
  process.exit(2);
}
const vscode = JSON.parse(readFileSync(vscodeFile, 'utf8'));
const web = JSON.parse(readFileSync(webFile, 'utf8'));

// UNK-014's evidence rule.
const OPEN_LIMIT_MS = 3000;
const EDIT_LIMIT_MS = 500;

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value) => (value === undefined ? '—' : `${Math.round(value).toLocaleString('en-US')}`);

/** "median (run1, run2, run3)" in ms, or the error of the first failed run. */
function cell(runs, pick = (r) => r.ms) {
  const failed = runs.find((r) => r.error);
  if (!runs.length) return 'not run';
  if (failed) return 'fails (see Errors below)';
  const values = runs.map(pick);
  return `**${ms(median(values))}** (${values.map(ms).join(', ')})`;
}

function okRuns(runs) {
  return runs.length > 0 && !runs.some((r) => r.error);
}

const sizes = vscode.sizes.map((v) => ({
  mib: v.mib,
  bytes: v.bytes,
  vscode: v,
  web: web.sizes.find((w) => w.mib === v.mib) ?? { render: [], edit: [] },
}));

const commit = process.env.GITHUB_SHA ?? 'local';
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
  '> Re-run it after 003 T5 (see "What is measured"), and again whenever spec 008 needs new numbers.',
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : 'local machine (not the CI runner)'}; commit \`${commit}\`.`,
  `- Machine: ${process.env.RUNNER_OS ?? os.type()} ${os.arch()} (\`${process.env.ImageOS ?? os.release()}\`), ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- VS Code ${vscode.vscodeVersion} (stable at run time, \`--disable-gpu\`, under xvfb); Chromium ${web.chromium} (Playwright, headless).`,
  `- ${vscode.runs} runs per size and measure; each cell is **median** (run 1, run 2, run 3), in milliseconds. The editor is closed between runs, so every run opens the file again in the same VS Code window.`,
  "- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.",
  '',
  '## Results',
  '',
  '| Size | Open in custom editor (VS Code) | First render (Chromium) | Edit, UI part (Chromium) | Edit, host part (VS Code) |',
  '|---|---|---|---|---|',
);
for (const s of sizes) {
  add(
    `| ${s.mib} MiB (${s.bytes.toLocaleString('en-US')} B) | ${cell(s.vscode.open)} | ${cell(s.web.render)} | ${cell(s.web.edit)} | ${cell(s.vscode.edit, (r) => r.totalMs)} |`,
  );
}

add(
  '',
  'Where the host part of the edit goes (medians, ms):',
  '',
  '| Size | `document.getText()` | `core` applyPatch | Find the changed span | `workspace.applyEdit` |',
  '|---|---|---|---|---|',
);
for (const s of sizes) {
  const runs = s.vscode.edit;
  if (!okRuns(runs)) {
    add(`| ${s.mib} MiB | — | — | — | — |`);
    continue;
  }
  const m = (key) => ms(median(runs.map((r) => r[key])));
  add(
    `| ${s.mib} MiB | ${m('getTextMs')} | ${m('applyPatchMs')} | ${m('spanMs')} | ${m('applyEditMs')} |`,
  );
}

add(
  '',
  'In Chromium the UI handed the patch to the host after (medians, ms): ' +
    sizes
      .filter((s) => okRuns(s.web.edit))
      .map((s) => `${s.mib} MiB ${ms(median(s.web.edit.map((r) => r.toHostMs)))}`)
      .join(', ') +
    '; the UI cell above runs on to the first frame that shows the new value.',
  '',
  "## Against UNK-014's rule (open < 3 s, one edit < 500 ms)",
  '',
  "Open here is VS Code's part only and the edit is UI part + host part, without the message between",
  'them, so each number is a lower bound on what a user will see once 003 T5 joins them. A size that',
  'fails here fails for good; a size that passes here can still fail after 003 T5.',
  '',
  '| Size | Open | Edit (UI + host medians) | Verdict on these numbers |',
  '|---|---|---|---|',
);
const passing = [];
for (const s of sizes) {
  const open = okRuns(s.vscode.open) ? median(s.vscode.open.map((r) => r.ms)) : undefined;
  const edit =
    okRuns(s.vscode.edit) && okRuns(s.web.edit)
      ? median(s.vscode.edit.map((r) => r.totalMs)) + median(s.web.edit.map((r) => r.ms))
      : undefined;
  const openOk = open !== undefined && open < OPEN_LIMIT_MS;
  const editOk = edit !== undefined && edit < EDIT_LIMIT_MS;
  if (openOk && editOk) passing.push(s.mib);
  const why = [
    open === undefined ? 'cannot open' : openOk ? undefined : 'open too slow',
    edit === undefined ? 'no edit possible' : editOk ? undefined : 'edit too slow',
  ].filter(Boolean);
  add(
    `| ${s.mib} MiB | ${open === undefined ? 'fails' : ms(open)} | ${edit === undefined ? '—' : ms(edit)} | ${why.length ? `miss: ${why.join(', ')}` : 'pass so far'} |`,
  );
}
add(
  '',
  passing.length
    ? `Largest size that passes so far: **${Math.max(...passing)} MiB**. It is an upper bound for spec 008's threshold until the run after 003 T5.`
    : 'No measured size passes, so spec 008 needs a threshold below the smallest size measured here.',
);

add(
  '',
  '## What is measured',
  '',
  "On the commit above, the custom editor's webview is still the 003 T4 placeholder: it never receives",
  "the document (003 T5 wires that), and under its CSP the editor's styles are blocked (UNK-029). So",
  'no single measure covers "open a file and see it in the editor" yet. Instead:',
  '',
  '- **Open in custom editor:** `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview\'s',
  '  script has reported that it ran (e2e test hook). Covers VS Code reading the file, syncing it to the',
  '  extension host and creating the webview. Not covered: sending the text to the webview.',
  '- **First render:** the app-shell standalone page (`packages/app-shell`, the same vanilla-jsoneditor',
  '  003 T5 mounts) in Chromium. Its DevHostAdapter hands the text to the UI as a host `update`, the',
  "  path a webview takes when the host sends a document; timed until the tree shows the root's",
  '  "<n> items" tag (so the whole text was parsed) and the next frame. Not the VS Code webview, and',
  '  styles do apply on this page. The library parses with `JSON.parse` here; 003 T5 switches it to',
  '  `core` (criterion 10), which may be slower.',
  "- **Edit, UI part:** in that page, double-click the first record's `name`, type, press Enter; timed",
  '  from the Enter keydown to the first frame that shows the new value.',
  "- **Edit, host part:** what the extension host does with that patch in 003 T5's design: read the",
  '  document text, `core` applyPatch (style-preserving `replace` of one string in the middle record),',
  '  reduce the new text to the one changed span, and apply it with `workspace.applyEdit`.',
  '',
  'To reproduce: `CHR_TEST_HOOKS=1 pnpm package && pnpm build`, then `xvfb-run -a pnpm --filter',
  '@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).',
);

const failures = sizes.flatMap((s) =>
  [...s.vscode.open, ...s.vscode.edit, ...s.web.render, ...s.web.edit]
    .filter((r) => r.error)
    .map((r) => `- ${s.mib} MiB: ${r.error.replace(/\s+/g, ' ')}`),
);
if (failures.length) add('', '## Errors, as recorded', '', ...failures);

writeFileSync(out, lines.join('\n') + '\n');
console.log(`bench: wrote ${out}`);
