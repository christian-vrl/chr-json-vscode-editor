// `pnpm --filter @chr-json-editor/bench bench:compare` (007 T5, evidence for UNK-037): generates
// each size's document and its changed copy, times `compare` in core (core/compare.mjs) and the
// compare panel in VS Code (vscode/compare-suite.cjs), and writes bench/compare.md. Needs
// `pnpm build`, the e2e .vsix (`CHR_TEST_HOOKS=1 pnpm package`) and a display (`xvfb-run -a` on
// Linux). Run from any directory.
//
//   node bench/compare.mjs [sizes...]   default: 1 5 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '.data');
const results = path.join(here, '.results');
const sizes = process.argv.slice(2);
mkdirSync(results, { recursive: true });

const node = (script, args, env = {}) =>
  execFileSync(process.execPath, [path.join(here, script), ...args], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

node('generate.mjs', ['--changed', data, ...sizes]);
node('core/compare.mjs', [path.join(results, 'compare-core.json'), ...sizes]);
node('vscode/run.mjs', [data, path.join(results, 'compare-vscode.json'), ...sizes], {
  CHR_BENCH_SUITE: 'compare-suite.cjs',
});
node('compare-report.mjs', [results, path.join(here, 'compare.md')]);
