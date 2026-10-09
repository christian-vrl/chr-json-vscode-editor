// `pnpm --filter @chr-json-editor/bench bench` (003 T11): generates the files, times them in VS Code's
// custom editor and writes bench/vscode-open.md. Needs `pnpm build`, the e2e .vsix
// (`CHR_TEST_HOOKS=1 pnpm package`) and a display (`xvfb-run -a` on Linux). Run from any directory.
//
// 1 MiB is timed again in a second VS Code launch, since the first launch's numbers at the
// smallest size move with how warm the machine is (003 T11 review of PR #37).
//
//   node bench/run.mjs [sizes...]   default: 1 5 10 50 (MiB)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '.data');
const results = path.join(here, '.results');
const sizes = process.argv.slice(2);
mkdirSync(results, { recursive: true });

const node = (script, args) =>
  execFileSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' });

node('generate.mjs', [data, ...sizes]);
node('vscode/run.mjs', [data, path.join(results, 'vscode.json'), ...sizes]);
node('vscode/run.mjs', [data, path.join(results, 'vscode-second.json'), '1']);
node('report.mjs', [results, path.join(here, 'vscode-open.md')]);
