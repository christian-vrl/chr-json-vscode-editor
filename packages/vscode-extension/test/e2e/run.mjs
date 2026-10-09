// pnpm test:e2e (001 T5, spec 001 criterion 2): installs the .vsix written by `pnpm package` into a
// fresh VS Code profile with --install-extension, then runs suite.cjs inside that VS Code to assert
// the installed extension activates. Needs a display: run under `xvfb-run` on Linux.
//
// The .vsix must be the e2e build, `CHR_TEST_HOOKS=1 pnpm package` (esbuild.mjs): the suite reads
// webview state through test hooks that release builds compile out (spec 003 §Acceptance criterion).
//
// VS Code is downloaded by @vscode/test-electron (dev-time only; nothing ships). Where its download
// host is unreachable, set VSCODE_EXECUTABLE_PATH to an existing VS Code executable instead.
// CHR_E2E_VSCODE_VERSION picks the downloaded release (default `stable`); the vscode-matrix
// workflow sets it to test older releases (UNK-016).
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

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '../..');

const vsixFiles = readdirSync(packageDir).filter((f) => f.endsWith('.vsix'));
if (vsixFiles.length !== 1) {
  console.error(
    `test:e2e: expected exactly one .vsix in ${packageDir}, found ${vsixFiles.length}; run \`pnpm package\` first.`,
  );
  process.exit(1);
}
const vsix = path.join(packageDir, vsixFiles[0]);

const vscodeExecutablePath =
  process.env.VSCODE_EXECUTABLE_PATH ??
  (await downloadAndUnzipVSCode(process.env.CHR_E2E_VSCODE_VERSION || 'stable'));

const profile = mkdtempSync(path.join(tmpdir(), 'chr-json-editor-e2e-'));
const extensionsDir = path.join(profile, 'extensions');
const profileArgs = [
  `--extensions-dir=${extensionsDir}`,
  `--user-data-dir=${path.join(profile, 'user-data')}`,
];

try {
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath, {
    reuseMachineInstall: true,
  });
  const install = spawnSync(cli, [...cliArgs, ...profileArgs, '--install-extension', vsix], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    console.error(`test:e2e: --install-extension ${vsix} failed (exit ${install.status})`);
    process.exitCode = 1;
  } else {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.join(here, 'harness'),
      extensionTestsPath: path.join(here, 'suite.cjs'),
      extensionTestsEnv: {
        CHR_E2E_EXTENSIONS_DIR: extensionsDir,
        // 004 T5 writes `json.schemas`/`json5.schemas` here, as a user would (inline.cjs).
        CHR_E2E_USER_SETTINGS: path.join(profile, 'user-data', 'User', 'settings.json'),
      },
      // Chromium's timer throttling flags (003 T6): under xvfb about one run in three aligned the
      // webview's text-mode debounce timer to whole seconds (the edit arrived 1000 ms after typing,
      // not 300 ms, with the page visible and focused), which a user's visible window does not do.
      launchArgs: [
        ...profileArgs,
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    console.log('test:e2e: passed');
  }
} catch (error) {
  console.error('test:e2e: failed', error);
  process.exitCode = 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
