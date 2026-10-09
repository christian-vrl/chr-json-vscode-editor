// 003 T11 benchmark in VS Code: installs the e2e .vsix (`CHR_TEST_HOOKS=1 pnpm package`)
// into a fresh profile, the same way packages/vscode-extension/test/e2e/run.mjs does, and runs
// suite.cjs on the files bench/generate.mjs wrote. Needs a display: run under `xvfb-run` on Linux.
//
//   node bench/vscode/run.mjs <dataDir> <out.json> [sizes...]
//
// Where VS Code's download host is unreachable, set VSCODE_EXECUTABLE_PATH to an existing VS Code.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';
import { SIZES_MIB, fileName } from '../generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, '../../packages/vscode-extension');

const [dataDir = 'bench/.data', out = 'bench/.results/vscode.json', ...sizeArgs] =
  process.argv.slice(2);
const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
const files = sizes.map((mib) => ({ mib, path: path.resolve(dataDir, fileName(mib)) }));

const vsixFiles = readdirSync(extensionDir).filter((f) => f.endsWith('.vsix'));
if (vsixFiles.length !== 1) {
  console.error(`bench: expected one .vsix in ${extensionDir}, found ${vsixFiles.length}`);
  process.exit(1);
}
const vsix = path.join(extensionDir, vsixFiles[0]);

const vscodeExecutablePath =
  process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));

const profile = mkdtempSync(path.join(tmpdir(), 'chr-json-editor-bench-'));
const profileArgs = [
  `--extensions-dir=${path.join(profile, 'extensions')}`,
  `--user-data-dir=${path.join(profile, 'user-data')}`,
];

try {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, {
    reuseMachineInstall: true,
  });
  const install = spawnSync(cli, [...cliArgs, ...profileArgs, '--install-extension', vsix], {
    stdio: 'inherit',
  });
  if (install.status !== 0) throw new Error(`--install-extension failed (exit ${install.status})`);
  await runTests({
    vscodeExecutablePath,
    // The e2e suite's empty development extension (see its package.json).
    extensionDevelopmentPath: path.join(extensionDir, 'test/e2e/harness'),
    extensionTestsPath: path.join(here, 'suite.cjs'),
    extensionTestsEnv: {
      CHR_BENCH_OUT: path.resolve(out),
      CHR_BENCH_FILES: JSON.stringify(files),
    },
    launchArgs: [...profileArgs, '--disable-gpu', '--disable-workspace-trust'],
  });
  console.log(`bench: wrote ${out}`);
} catch (error) {
  console.error('bench: VS Code run failed', error);
  process.exitCode = 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
