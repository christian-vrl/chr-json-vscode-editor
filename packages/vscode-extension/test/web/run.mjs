// pnpm test:e2e:web (spec 013 T1, ADR-013): runs the web e2e suite (suite/, bundled here) in VS
// Code's web worker extension host against the extension loaded from the files of the .vsix that
// `CHR_TEST_HOOKS=1 pnpm package` wrote (the e2e build, as for pnpm test:e2e).
//
// Two routes (spec 013 criteria 13, plan R1):
// - CI route (default): @vscode/test-web serves VS Code stable's web build, downloaded from
//   update.code.visualstudio.com into .vscode-test-web, in headless Playwright Chromium, with a copy
//   of the fixtures mounted at vscode-test-web://mount/.
// - Local route: with VSCODE_EXECUTABLE_PATH set, desktop VS Code at that path, started with
//   --extensionDevelopmentKind=web, runs the same suite bundle in its web worker host on a file:
//   copy of the fixtures. No download. Needs a display: run under `xvfb-run` on Linux.
// README.md names what only the CI route covers.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '../..');
const repo = path.resolve(packageDir, '../..');

function fail(message) {
  console.error(`test:e2e:web: ${message}`);
  process.exit(1);
}

const vsixFiles = readdirSync(packageDir).filter((f) => f.endsWith('.vsix'));
if (vsixFiles.length !== 1) {
  fail(
    `expected exactly one .vsix in ${packageDir}, found ${vsixFiles.length}; run \`CHR_TEST_HOOKS=1 pnpm package\` first.`,
  );
}

const work = mkdtempSync(path.join(tmpdir(), 'chr-web-'));
try {
  // The extension as the .vsix ships it: the package's files are under extension/ in the zip.
  const unzip = spawnSync(
    'unzip',
    ['-q', path.join(packageDir, vsixFiles[0]), '-d', path.join(work, 'vsix')],
    {
      stdio: 'inherit',
    },
  );
  if (unzip.status !== 0) fail(`unzip ${vsixFiles[0]} failed (exit ${unzip.status})`);
  const extensionPath = path.join(work, 'vsix', 'extension');
  // Criterion 1: one package, two entries, both in the .vsix.
  const manifest = JSON.parse(readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));
  for (const field of ['main', 'browser']) {
    if (!manifest[field] || !existsSync(path.join(extensionPath, manifest[field]))) {
      fail(`the .vsix manifest's "${field}" (${manifest[field]}) is missing or not in the .vsix`);
    }
  }

  const bundle = path.join(packageDir, 'dist-test', 'web', 'suite.js');
  await build({
    entryPoints: [path.join(here, 'suite', 'index.ts')],
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'chrome128',
    external: ['vscode'],
    logLevel: 'warning',
  });
  // VS Code runs --extensionTestsPath in the extension host of the development extension whose
  // folder holds it, and in the desktop's Node host otherwise; inside the extension's folder it runs
  // in the web worker host beside the extension. The .vsix's own files stay as they are.
  const suite = path.join(extensionPath, 'web-e2e-suite.js');
  cpSync(bundle, suite);

  // A fresh copy each run: the web e2e edits and saves fixtures (013 T4).
  const workspace = path.join(work, 'workspace');
  mkdirSync(workspace);
  for (const fixtures of ['open', 'smart-format']) {
    cpSync(path.join(repo, 'tests', 'e2e', 'fixtures', fixtures), path.join(workspace, fixtures), {
      recursive: true,
    });
  }

  if (process.env.VSCODE_EXECUTABLE_PATH) {
    const { runTests } = await import('@vscode/test-electron');
    console.log(
      `test:e2e:web: local route, ${process.env.VSCODE_EXECUTABLE_PATH} with --extensionDevelopmentKind=web`,
    );
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
      extensionDevelopmentPath: extensionPath,
      extensionTestsPath: suite,
      launchArgs: [
        workspace,
        '--extensionDevelopmentKind=web',
        // VS Code's IPC socket lives under the user data dir and must stay under 107 characters.
        `--user-data-dir=${path.join(work, 'u')}`,
        `--extensions-dir=${path.join(work, 'x')}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--disable-gpu',
      ],
    });
  } else {
    const { runTests } = await import('@vscode/test-web');
    console.log('test:e2e:web: CI route, @vscode/test-web with VS Code stable in Chromium');
    await runTests({
      browserType: 'chromium',
      headless: true,
      quality: 'stable',
      extensionDevelopmentPath: extensionPath,
      extensionTestsPath: suite,
      folderPath: workspace,
      testRunnerDataDir: path.join(packageDir, '.vscode-test-web'),
      printServerLog: false,
    });
  }
  console.log('test:e2e:web: passed');
} catch (error) {
  console.error('test:e2e:web: failed', error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
