// `pnpm --filter @chr-json-editor/bench bench:web-ceiling` (013 T5, UNK-054's evidence rule): the
// largest document that opens in VS Code's web host. Writes the bench generator's JSON documents
// at 5 MiB + 1 byte (spec 008's threshold + 1), 10, 25 and 50 MiB (VS Code's ceiling, 52,428,800
// bytes) and one byte over the ceiling, then runs packages/vscode-extension/test/web/run.mjs
// --ceiling three times (each a fresh browser, @vscode/test-web with VS Code stable in Chromium:
// the CI route) and writes bench/web-ceiling.md from the three runs (web-ceiling-report.mjs).
// Needs the e2e .vsix (`CHR_TEST_HOOKS=1 pnpm package`) and VS Code's web build download, which
// only CI reaches. Run from any directory.
//
//   node bench/web-ceiling.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentText, MIB } from './generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '.data', 'web-ceiling');
const results = path.join(here, '.results');
const runMjs = path.join(here, '..', 'packages', 'vscode-extension', 'test', 'web', 'run.mjs');
export const RUNS = 3;
/** The measured sizes in bytes, smallest first (UNK-054; tasks.md 013 T5). */
export const CASES = [
  5 * MIB + 1,
  10 * MIB,
  25 * MIB,
  50 * MIB, // VS Code's ceiling (spec 008 criterion 9)
  50 * MIB + 1,
];

rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
mkdirSync(results, { recursive: true });
const cases = CASES.map((bytes) => {
  const name = `${bytes}.json`;
  const text = documentText(bytes);
  writeFileSync(path.join(data, name), text);
  // The tree's root shows "<n> items" once every record is rendered.
  return { name, bytes, records: JSON.parse(text).length };
});
writeFileSync(path.join(data, 'cases.json'), JSON.stringify(cases));
console.log(`bench: wrote ${cases.length} documents to ${data}`);

const outputs = [];
for (let run = 1; run <= RUNS; run++) {
  const out = path.join(results, `web-ceiling-${run}.json`);
  rmSync(out, { force: true });
  console.log(`bench: web ceiling run ${run} of ${RUNS}`);
  // A run that fails (a crash, a timeout, a foreign request) still writes what it measured.
  const { status } = spawnSync(process.execPath, [runMjs, '--ceiling'], {
    stdio: 'inherit',
    cwd: path.dirname(path.dirname(path.dirname(runMjs))),
    env: { ...process.env, CHR_WEB_CEILING_DATA: data, CHR_WEB_CEILING_OUT: out },
  });
  console.log(`bench: run ${run} exited ${status}`);
  outputs.push({ run, status, file: out });
}
writeFileSync(path.join(results, 'web-ceiling-runs.json'), JSON.stringify(outputs));
execFileSync(
  process.execPath,
  [path.join(here, 'web-ceiling-report.mjs'), results, path.join(here, 'web-ceiling.md')],
  { stdio: 'inherit' },
);
