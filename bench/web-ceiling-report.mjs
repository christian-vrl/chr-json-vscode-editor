// Writes bench/web-ceiling.md (013 T5, the evidence for UNK-054) from the results
// bench/web-ceiling.mjs left in <resultsDir>: web-ceiling-runs.json and one web-ceiling-<n>.json per
// run. Every number in the report comes from those files. UNK-054's rule: the web ceiling is the
// largest size at which, in 3 of 3 runs, the tab opens in large-file mode, shows spec 008's banner
// within 30 s, and neither the worker nor the webview crashes.
//
//   node bench/web-ceiling-report.mjs <resultsDir> <out.md>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [resultsDir, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node bench/web-ceiling-report.mjs <resultsDir> <out.md>');
  process.exit(2);
}
const MIB = 2 ** 20;
const CEILING = 50 * MIB;
const BANNER_LIMIT_MS = 30_000;
const BANNER = /^Large file \(\d+\.\d MiB\): read-only to stay fast\.$/;
const CEILING_MESSAGE = (name, bytes) =>
  `${name} is ${(Math.floor((bytes * 10) / MIB) / 10).toFixed(1)} MiB. VS Code does not pass ` +
  `files above 50 MB to extensions, so CHR JSON Editor can't open it.`;

const runs = JSON.parse(readFileSync(path.join(resultsDir, 'web-ceiling-runs.json'), 'utf8')).map(
  (run) => ({
    ...run,
    lines: existsSync(run.file) ? JSON.parse(readFileSync(run.file, 'utf8')) : [],
  }),
);

/** The page or the extension host worker going away before the run's `end` line. */
function crashes(run) {
  const end = run.lines.find((l) => l.kind === 'end')?.at ?? Infinity;
  return run.lines.filter(
    (l) =>
      (l.kind === 'crash' || (l.kind === 'worker-closed' && /extensionHost/i.test(l.url))) &&
      !(l.at > end),
  );
}

const start = runs.flatMap((r) => r.lines).find((l) => l.kind === 'start');
const opens = (run) => run.lines.filter((l) => l.kind === 'open');
const sizes = [...new Set(runs.flatMap((r) => opens(r).map((o) => o.bytes)))].sort((a, b) => a - b);
const caseNames = start?.cases ?? sizes.map((b) => `${b}.json`);
const bytesOf = (name) => Number(name.replace(/\.json$/, ''));
const allSizes = [...new Set([...sizes, ...caseNames.map(bytesOf)])].sort((a, b) => a - b);

/** Whether one run's result for `bytes` meets UNK-054's rule, and why not. */
function verdict(run, bytes) {
  const o = opens(run).find((l) => l.bytes === bytes);
  if (!o) return { ok: false, why: crashes(run).length ? 'no result: crashed' : 'no result' };
  if (o.refused) return { ok: false, why: 'refused', o };
  if (o.error) return { ok: false, why: o.error, o };
  if (!o.largeFile || o.largeFile.unlocked || o.largeFile.bytes !== bytes)
    return { ok: false, why: `not in large-file mode (${JSON.stringify(o.largeFile)})`, o };
  if (!BANNER.test(o.banner ?? '')) return { ok: false, why: `banner "${o.banner}"`, o };
  if (!(o.bannerMs <= BANNER_LIMIT_MS))
    return { ok: false, why: `banner after ${o.bannerMs} ms`, o };
  if (!o.alive) return { ok: false, why: 'the webview stopped answering', o };
  return { ok: true, o };
}

const ms = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const n = (v) => v.toLocaleString('en-US');
const heap = (v) => (v == null ? '—' : `${Math.round(v / MIB)} MiB`);
const label = (bytes) => (bytes % MIB === 0 ? `${bytes / MIB} MiB` : `${n(bytes)} bytes`);

const passing = allSizes.filter(
  (bytes) => bytes <= CEILING && runs.length > 0 && runs.every((r) => verdict(r, bytes).ok),
);
// The largest passing size, provided every smaller measured size passes too.
let webCeiling;
for (const bytes of allSizes.filter((b) => b <= CEILING)) {
  if (!passing.includes(bytes)) break;
  webCeiling = bytes;
}
const over = allSizes.find((b) => b > CEILING);
const overRefused =
  over !== undefined &&
  runs.every((r) => {
    const o = opens(r).find((l) => l.bytes === over);
    return o?.refused?.length === 1 && o.refused[0] === CEILING_MESSAGE(`${over}.json`, over);
  });

const commit = process.env.BENCH_COMMIT || process.env.GITHUB_SHA || 'local';
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;
const cpus = os.cpus();
const lines = [];
const add = (...l) => lines.push(...l);

add(
  '# Web host ceiling (013 T5)',
  '',
  '> Evidence for UNK-054 and spec 013 criterion 10. Written by `bench/web-ceiling-report.mjs` from',
  '> one benchmark run (`bench/web-ceiling.mjs`); do not edit by hand.',
  '',
  '## Run',
  '',
  `- Where: ${runUrl ? `GitHub Actions, [run ${process.env.GITHUB_RUN_ID}](${runUrl})` : 'local'}; commit \`${commit}\`.`,
  `- Machine: ${os.type()} ${os.arch()}, ${cpus.length} × ${cpus[0]?.model ?? 'unknown CPU'}, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM.`,
  `- The CI route of \`pnpm test:e2e:web\` (\`test/web/run.mjs --ceiling\`): \`@vscode/test-web\` with VS Code stable's web build in headless Chromium (${start?.userAgent ? `\`${start.userAgent}\`` : 'user agent not recorded'}), the e2e .vsix, the documents mounted on \`vscode-test-web://mount/ceiling/\`.`,
  `- ${runs.length} runs, each a fresh browser and workbench; within a run every document is opened once, smallest first, with "Open in CHR JSON Editor", and the editor is closed before the next.`,
  '- Documents: `bench/generate.mjs` `documentText`, the 7-field records of `bench/vscode-open.md` in one pretty-printed JSON array, ASCII only, of exactly the size named.',
  `- Rule (UNK-054): a size passes when, in ${runs.length} of ${runs.length} runs, the tab opens locked in large-file mode, shows spec 008's banner within ${BANNER_LIMIT_MS / 1000} s, the webview still answers ${5} s after the tree shows every record, and neither the page nor the extension host worker crashes.`,
  '',
  '## Result',
  '',
  webCeiling === undefined
    ? '- **No measured size passes.** See the table.'
    : webCeiling === CEILING
      ? `- **Web ceiling: ${n(webCeiling)} bytes (50 MiB), VS Code's ceiling.** The web host uses spec 008's ceiling unchanged.`
      : `- **Web ceiling: ${n(webCeiling)} bytes (${label(webCeiling)}), below VS Code's ceiling.** The open command must refuse above it.`,
  over === undefined
    ? '- One byte over the ceiling: not measured.'
    : `- ${n(over)} bytes (one over the ceiling): ${overRefused ? `refused in every run with spec 008 criterion 9's message` : 'NOT refused with the message in every run; see the table'}.`,
  '',
  '## Opens',
  '',
  '| Size | Run | Verdict | Large-file mode | Banner (ms) | Webview ready (ms) | Tree shown (ms) | Webview heap |',
  '|---|---|---|---|---|---|---|---|',
);
for (const bytes of allSizes) {
  for (const run of runs) {
    const { ok, why, o } = verdict(run, bytes);
    const mode = o?.refused
      ? 'refused: ' + o.refused.join(' ')
      : o?.largeFile
        ? `locked, ${n(o.largeFile.bytes)} bytes`
        : o
          ? 'no'
          : '—';
    const shown =
      bytes > CEILING && o?.refused ? 'refused (expected)' : ok ? 'pass' : `fail: ${why}`;
    add(
      `| ${label(bytes)} | ${run.run} | ${shown} | ${mode} | ${ms(o?.bannerMs)} | ${ms(o?.readyMs)} | ${ms(o?.renderMs)} | ${heap(o?.webviewHeap)} |`,
    );
  }
}
add('', "## VS Code's sync limit in the web host", '');
add(
  '`vscode.workspace.openTextDocument` on the two largest documents (008 T4 measured desktop: 50 × 2^20 UTF-16 code units open, one more does not).',
  '',
  '| Size | Run | Opens | Text length or error |',
  '|---|---|---|---|',
);
for (const run of runs) {
  for (const s of run.lines.filter((l) => l.kind === 'sync')) {
    add(
      `| ${label(s.bytes)} | ${run.run} | ${s.opens ? 'yes' : 'no'} | ${s.opens ? n(s.length) : s.error} |`,
    );
  }
}
add('', '## Crashes and exit codes', '');
for (const run of runs) {
  const c = crashes(run);
  const end = run.lines.find((l) => l.kind === 'end')?.at ?? Infinity;
  const workers = run.lines.filter((l) => l.kind === 'worker').map((l) => `\`${l.url}\``);
  const closed = run.lines
    .filter((l) => l.kind === 'worker-closed' && !(l.at > end) && !c.includes(l))
    .map((l) => `\`${l.url}\``);
  add(
    `- Run ${run.run}: exit ${run.status}; ${c.length ? c.map((l) => (l.kind === 'crash' ? 'page crashed' : `extension host worker closed: ${l.url}`)).join('; ') : 'no page crash, the extension host worker stayed up'}. Workers started: ${workers.join(', ') || 'none recorded'}; other workers closed before the end: ${closed.join(', ') || 'none'}.`,
  );
}
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
