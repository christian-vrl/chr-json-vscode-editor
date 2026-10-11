// pnpm --filter chr-json-editor-spike-query-engine spike (spike 011 T1). Builds the spike, writes
// the bench fixtures, runs the Node preflight and the Node reference, then runs suite.cjs inside
// VS Code with the spike extension loaded from this folder in a fresh profile. Results land in
// results/.
//
// Needs a display (xvfb-run on Linux). VS Code comes from VSCODE_EXECUTABLE_PATH, or is downloaded
// by @vscode/test-electron (dev-time only).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { describeFixtures } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const node = (args) => spawnSync(process.execPath, args, { cwd: here, stdio: 'inherit' }).status;

if (node(['build.mjs']) !== 0) process.exit(1);

const work = mkdtempSync(path.join(tmpdir(), 'chr-spike-query-'));
try {
  const fixtures = describeFixtures();
  for (const fixture of fixtures) {
    writeFileSync(path.join(work, `${fixture.id}.json`), fixture.text);
    console.log(
      `fixture ${fixture.id}: ${fixture.bytes} bytes, ${fixture.items} items, sha256 ${fixture.sha256}`,
    );
  }
  writeFileSync(
    path.join(work, 'fixtures.json'),
    JSON.stringify(fixtures.map((f) => ({ ...f, text: undefined }))),
  );

  // Every probe outside VS Code first: one that never stops would hang the webview.
  if (node(['dist/preflight.mjs']) !== 0) process.exit(1);
  if (node(['dist/node-reference.mjs', work, '5']) !== 0) process.exit(1);

  const vscodeExecutablePath =
    process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: here,
    extensionTestsPath: path.join(here, 'suite.cjs'),
    extensionTestsEnv: { SPIKE_FIXTURE_DIR: work, SPIKE_RESULTS_DIR: path.join(here, 'results') },
    launchArgs: [
      `--extensions-dir=${path.join(work, 'extensions')}`,
      `--user-data-dir=${path.join(work, 'user-data')}`,
      '--disable-extensions',
      '--disable-gpu',
      work,
    ],
  });
  console.log('spike: done');
} catch (error) {
  console.error('spike: failed', error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
