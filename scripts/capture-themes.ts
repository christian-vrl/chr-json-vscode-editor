// Captures the CSS variables VS Code gives webviews under its default light, dark and high-contrast
// themes into tests/themes/{light,dark,hc}.json (spec 003 T9, criterion 7). `pnpm test:web` loads
// them into the app-shell page and runs axe-core's color-contrast rule. Re-run after a VS Code
// update to refresh them: `pnpm capture:themes` (under `xvfb-run` on Linux).
//
// VS Code is downloaded by @vscode/test-electron (dev-time only; nothing ships). Where its download
// host is unreachable, set VSCODE_EXECUTABLE_PATH to an existing VS Code executable instead.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const here = import.meta.dirname;
const outDir = path.resolve(here, '../tests/themes');

const vscodeExecutablePath =
  process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));

// A fresh profile, so no user setting or installed extension changes the default themes.
const profile = mkdtempSync(path.join(tmpdir(), 'chr-json-editor-themes-'));
try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: path.join(here, 'capture-themes/harness'),
    extensionTestsPath: path.join(here, 'capture-themes/in-vscode.cjs'),
    extensionTestsEnv: { CHR_THEMES_OUT: outDir },
    launchArgs: [
      `--extensions-dir=${path.join(profile, 'extensions')}`,
      `--user-data-dir=${path.join(profile, 'user-data')}`,
      '--disable-gpu',
    ],
  });
} catch (error) {
  console.error('capture-themes: failed', error);
  process.exitCode = 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
