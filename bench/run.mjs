// `pnpm --filter @chr-json-editor/bench bench` (003 T11): generates the files, runs the VS Code and
// Chromium halves, and writes bench/vscode-open.md. Needs `pnpm build`, the e2e .vsix
// (`CHR_TEST_HOOKS=1 pnpm package`) and a display (`xvfb-run -a` on Linux). Run from any directory.
//
//   node bench/run.mjs [sizes...]   default: 1 10 50 100 (MiB)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '.data');
const results = path.join(here, '.results');
const sizes = process.argv.slice(2);
mkdirSync(results, { recursive: true });

const node = (script, ...args) =>
  execFileSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' });

node('generate.mjs', data, ...sizes);
node('vscode/run.mjs', data, path.join(results, 'vscode.json'), ...sizes);
node('web/run.mjs', data, path.join(results, 'web.json'), ...sizes);
node(
  'report.mjs',
  path.join(results, 'vscode.json'),
  path.join(results, 'web.json'),
  path.join(here, 'vscode-open.md'),
);
