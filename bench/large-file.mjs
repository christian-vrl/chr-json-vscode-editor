// `pnpm --filter @chr-json-editor/bench bench:large-file` (008 T5: spec 008 criterion 11, UNK-041,
// plan R5 and R6): generates the JSON, JSONC and JSON5 files, times large-file mode in VS Code's
// custom editor (vscode/large-file-suite.cjs) and writes bench/large-file.md. Needs `pnpm build`,
// the e2e .vsix (`CHR_TEST_HOOKS=1 pnpm package`) and a display (`xvfb-run -a` on Linux). Run from
// any directory.
//
//   node bench/large-file.mjs [sizes...]   default: 6 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '.data');
const results = path.join(here, '.results');
const args = process.argv.slice(2);
const sizes = args.length ? args : ['6', '10', '50'];
mkdirSync(results, { recursive: true });

const node = (script, scriptArgs, env = {}) =>
  execFileSync(process.execPath, [path.join(here, script), ...scriptArgs], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

node('generate.mjs', ['--formats', data, ...sizes]);
node('vscode/run.mjs', [data, path.join(results, 'large-file.json'), ...sizes], {
  CHR_BENCH_SUITE: 'large-file-suite.cjs',
  CHR_BENCH_FORMATS: 'json,jsonc,json5',
});
node('large-file-report.mjs', [results, path.join(here, 'large-file.md')]);
