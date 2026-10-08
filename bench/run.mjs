// `pnpm --filter @chr-json-editor/bench bench` (003 T11): generates the files, times them in VS Code's
// custom editor and writes bench/vscode-open.md. Needs `pnpm build`, the e2e .vsix
// (`CHR_TEST_HOOKS=1 pnpm package`) and a display (`xvfb-run -a` on Linux). Run from any directory.
//
// With CHR_BENCH_UNMINIFIED_VSIX set to an e2e .vsix built with CHR_WEBVIEW_MINIFY=0, it also times
// open at 1 MiB with that build, to compare the minified and unminified webview.js (bench.yml).
//
//   node bench/run.mjs [sizes...]   default: 1 10 50 (MiB)
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

node('generate.mjs', [data, ...sizes]);
node('vscode/run.mjs', [data, path.join(results, 'vscode.json'), ...sizes]);
const unminified = process.env.CHR_BENCH_UNMINIFIED_VSIX;
if (unminified) {
  node('vscode/run.mjs', [data, path.join(results, 'vscode-unminified.json'), '1'], {
    CHR_BENCH_VSIX: unminified,
  });
}
node('report.mjs', [results, path.join(here, 'vscode-open.md')]);
