// pnpm --filter chr-json-editor-spike-eval-location spike (spike 004 T1). Builds the spike, writes
// the benchmark fixture, computes the Node reference errors, then runs suite.cjs inside VS Code with
// the spike extension loaded from this folder in a fresh profile. Results land in results/.
//
// Needs a display (xvfb-run on Linux). VS Code comes from VSCODE_EXECUTABLE_PATH, or is downloaded
// by @vscode/test-electron (dev-time only).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { describeFixture } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const built = spawnSync(process.execPath, ['build.mjs'], { cwd: here, stdio: 'inherit' });
if (built.status !== 0) process.exit(1);

const work = mkdtempSync(path.join(tmpdir(), 'chr-spike-eval-'));
try {
  const fixture = describeFixture();
  writeFileSync(path.join(work, 'doc.json'), fixture.text);
  writeFileSync(path.join(work, 'fixture.json'), JSON.stringify({ ...fixture, text: undefined }));
  console.log(
    `fixture: ${fixture.bytes} bytes, ${fixture.items} items, ${fixture.rules} rules, sha256 ${fixture.sha256}`,
  );

  // Node reference: the same Ajv routine outside VS Code.
  const reference = spawnSync(process.execPath, ['dist/node-reference.mjs', work], {
    cwd: here,
    stdio: 'inherit',
  });
  if (reference.status !== 0) process.exit(1);

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
