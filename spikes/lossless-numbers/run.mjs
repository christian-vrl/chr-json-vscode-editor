// pnpm --filter chr-json-editor-spike-lossless-numbers spike (spike 015 T1). Builds the spike,
// writes the bench texts, runs the Node bench, then runs suite.cjs inside VS Code with the spike
// extension loaded from this folder in a fresh profile. Results land in results/.
//
// Needs a display (xvfb-run on Linux); core is bundled from its sources.
// VS Code comes from VSCODE_EXECUTABLE_PATH, or is downloaded by @vscode/test-electron (dev-time
// only). SPIKE_SKIP_NODE=1 skips the Node bench;
// SPIKE_PROBES_ONLY=1 skips the webview bench.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { benchTexts } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const node = (args) => spawnSync(process.execPath, args, { cwd: here, stdio: 'inherit' }).status;
const RUNS = { 5: 9, 50: 3 };

if (node(['build.mjs']) !== 0) process.exit(1);

const work = mkdtempSync(path.join(tmpdir(), 'chr-spike-lossless-'));
try {
  const texts = benchTexts().map((t) => ({ ...t, runs: RUNS[Math.round(t.bytes / 2 ** 20)] }));
  for (const t of texts) {
    writeFileSync(path.join(work, `${t.id}.json`), t.text);
    console.log(`text ${t.id}: ${t.bytes} bytes, ${t.bigNumbers} big numbers, sha256 ${t.sha256}`);
  }
  writeFileSync(
    path.join(work, 'texts.json'),
    JSON.stringify(texts.map((t) => ({ ...t, text: undefined }))),
  );

  if (!process.env.SPIKE_SKIP_NODE) {
    const out = path.join(here, 'results', 'node.json');
    if (node(['--max-old-space-size=8192', 'dist/node-bench.mjs', work, out]) !== 0) {
      process.exit(1);
    }
  }

  const vscodeExecutablePath =
    process.env.VSCODE_EXECUTABLE_PATH ?? (await downloadAndUnzipVSCode('stable'));
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: here,
    extensionTestsPath: path.join(here, 'suite.cjs'),
    extensionTestsEnv: {
      SPIKE_FIXTURE_DIR: work,
      SPIKE_RESULTS_DIR: path.join(here, 'results'),
      SPIKE_PROBES_ONLY: process.env.SPIKE_PROBES_ONLY ?? '',
      SPIKE_PROBE_FIXTURE: path.join(here, '../../tests/e2e/fixtures/big-numbers/input.json'),
    },
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
