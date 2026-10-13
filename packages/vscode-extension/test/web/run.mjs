// pnpm test:e2e:web (spec 013 T1, ADR-013): runs the web e2e suite (suite/, bundled here) in VS
// Code's web worker extension host against the extension loaded from the files of the .vsix that
// `CHR_TEST_HOOKS=1 pnpm package` wrote (the e2e build, as for pnpm test:e2e).
//
// Two routes (spec 013 criteria 13, plan R1):
// - CI route (default): @vscode/test-web serves VS Code stable's web build, downloaded from
//   update.code.visualstudio.com into .vscode-test-web, with a copy of the fixtures mounted at
//   vscode-test-web://mount/. This script opens it in headless Playwright Chromium itself (013 T4),
//   so it can record the page's requests (criterion 11) and drive the command palette (criterion 8).
// - Local route: with VSCODE_EXECUTABLE_PATH set, desktop VS Code at that path, started with
//   --extensionDevelopmentKind=web, runs the same suite bundle in its web worker host on a file:
//   copy of the fixtures. No download. Needs a display: run under `xvfb-run` on Linux.
// README.md names what only the CI route covers.
//
// `--probe` (CI route only) runs suite/probe.ts instead of the suite: the expected-failure fixture
// of criterion 11. Its fetch from the worker must make this script exit 1 with "network:".
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '../..');
const repo = path.resolve(packageDir, '../..');
const probe = process.argv.includes('--probe');

/** The port @vscode/test-web serves on (its default). */
const PORT = 3000;
/** What the suite logs to ask for a command palette check (criterion 8): `<n> <filter>`; the answer
 *  goes into the mounted folder as PALETTE_ANSWER(n) (suite/palette.ts). */
const PALETTE_REQUEST = '[chr-web-e2e] palette ';
const PALETTE_ANSWER = (n) => `chr-web-e2e-palette-${n}.json`;
/** How long the whole suite may take on the CI route (the CI job allows 20 minutes). */
const SUITE_TIMEOUT_MS = 15 * 60_000;
/** The golden patch cases per format that criterion 4 applies (as test/e2e/sync.cjs). */
const GOLDEN_CASES_PER_FORMAT = 10;
/** The `op` tags of whole-document golden cases (tests/golden/load.ts `wholeDocumentOps`). */
const WHOLE_DOCUMENT_OPS = ['compact', 'sort', 'data-diff', 'format'];

function fail(message) {
  console.error(`test:e2e:web: ${message}`);
  process.exit(1);
}

/** The folder the suite runs in: the fixtures it needs, each run a fresh copy (the suite edits and
 *  saves them), and the workspace settings criterion 5 reads. */
function makeWorkspace(workspace) {
  mkdirSync(workspace);
  cpSync(path.join(repo, 'tests', 'e2e', 'fixtures'), path.join(workspace, 'fixtures'), {
    recursive: true,
  });
  cpSync(path.join(repo, 'tests', 'compare'), path.join(workspace, 'compare'), {
    recursive: true,
  });
  cpSync(path.join(repo, 'tests', 'csv'), path.join(workspace, 'csv'), { recursive: true });
  // The first golden patch cases of each format, as the desktop e2e picks them (sync.cjs).
  const golden = {};
  for (const format of ['json', 'jsonc', 'json5']) {
    const from = path.join(repo, 'tests', 'golden', format);
    golden[format] = readdirSync(from)
      .sort()
      .filter((name) => {
        const tags = JSON.parse(readFileSync(path.join(from, name, 'case.json'), 'utf8'));
        // As in sync.cjs: big-number patches (spec 015) are read with JSON.parse and would round.
        return !WHOLE_DOCUMENT_OPS.includes(tags.op) && tags.special !== 'big-number';
      })
      .slice(0, GOLDEN_CASES_PER_FORMAT);
    for (const name of golden[format]) {
      cpSync(path.join(from, name), path.join(workspace, 'golden', format, name), {
        recursive: true,
      });
    }
  }
  writeFileSync(path.join(workspace, 'golden', 'cases.json'), JSON.stringify(golden));
  // Criterion 5: a workspace folder's `json.schemas` and `json5.schemas`, with urls relative to the
  // folder (criterion 6), select fixtures/inline/people.*. VS Code's own JSON language features run
  // in the same web worker extension host and download https schemas by default, which the network
  // check (criterion 11) would count against us: they are off, as a user working offline sets them.
  mkdirSync(path.join(workspace, '.vscode'));
  const url = './fixtures/inline/people.schema.json';
  writeFileSync(
    path.join(workspace, '.vscode', 'settings.json'),
    JSON.stringify(
      {
        'json.schemas': [
          { fileMatch: ['/inline/people.json', '/inline/people.jsonc'], url },
          { fileMatch: ['remote-schema.json'], url: 'https://example.com/s.json' },
        ],
        'json5.schemas': [{ fileMatch: ['/inline/people.json5'], url }],
        'json.schemaDownload.enable': false,
      },
      null,
      2,
    ),
  );
  mkdirSync(path.join(workspace, 'work'));
}

/**
 * Opens the web build in Chromium and runs the suite there (the CI route). Resolves with the
 * suite's exit code. Records every request from the extension host worker and from our webviews'
 * frames (criterion 11), and answers the suite's palette requests through the page (criterion 8).
 */
async function runInBrowser({ extensionPath, suite, workspace }) {
  const testWeb = await import('@vscode/test-web');
  // Playwright as @vscode/test-web resolves it, so both drive the same browser build.
  const { chromium } = createRequire(createRequire(import.meta.url).resolve('@vscode/test-web'))(
    'playwright',
  );
  const origin = `http://localhost:${PORT}`;
  const server = await testWeb.open({
    browserType: 'none',
    quality: 'stable',
    // A web build already in .vscode-test-web (folder vscode-web-stable-<commit>) is used without
    // asking update.code.visualstudio.com for the latest one.
    commit: process.env.CHR_WEB_E2E_COMMIT || undefined,
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath: suite,
    folderPath: workspace,
    testRunnerDataDir: path.join(packageDir, '.vscode-test-web'),
    printServerLog: false,
    port: PORT,
  });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    // The CSV panel's "Copy CSV" goes through the browser's clipboard (spec 009).
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const requests = [];
    const record = (request, from) => requests.push({ url: request.url(), from });
    // Criterion 11's sources: the worker extension host (and any worker it starts) and the frames
    // of our webviews. VS Code's own workbench frames are not counted.
    page.on('worker', (worker) => worker.on('request', (r) => record(r, `worker ${worker.url()}`)));
    context.on('request', (request) => {
      if (request.serviceWorker()) return; // the webview service worker serves from the server
      let frame;
      try {
        frame = request.frame();
      } catch {
        return record(request, 'worker');
      }
      if (/\/webview\/browser\/pre\//.test(frame.url())) record(request, `webview ${frame.url()}`);
      else if (/webWorkerExtensionHostIframe/.test(frame.url()))
        record(request, `extension host ${frame.url()}`);
    });

    let palette = Promise.resolve();
    const exit = new Promise((resolve) => {
      page.exposeFunction('codeAutomationLog', (type, args) => {
        console[type](...args);
        const line = args.map(String).join(' ');
        if (line.startsWith(PALETTE_REQUEST)) {
          const [, n, filter] = /^(\d+) (.*)$/s.exec(line.slice(PALETTE_REQUEST.length)) ?? [];
          const answer = path.join(workspace, PALETTE_ANSWER(n));
          palette = palette.then(() => checkPalette(page, filter, answer));
        }
      });
      page.exposeFunction('codeAutomationExit', (code) => resolve(code));
    });
    // The page's own console and errors (CHR_WEB_E2E_VERBOSE=1), for a workbench that never starts.
    if (process.env.CHR_WEB_E2E_VERBOSE) {
      page.on('console', (message) => console.log(`page: ${message.text()}`));
      page.on('pageerror', (error) => console.log(`page error: ${error}`));
    }
    await page.goto(`${origin}/`);
    const code = await Promise.race([
      exit,
      new Promise((resolve) =>
        setTimeout(() => {
          console.error(
            `test:e2e:web: the suite did not finish in ${SUITE_TIMEOUT_MS / 60_000} min`,
          );
          resolve(1);
        }, SUITE_TIMEOUT_MS),
      ),
    ]);
    await palette;

    // Criterion 11: one origin, the test server's (`data:` and `blob:` URLs load nothing from a
    // network).
    const allowed = (url) => /^(data|blob):/.test(url) || new URL(url).origin === origin;
    const counted = requests.filter(({ url }) => !/^(data|blob):/.test(url));
    const foreign = requests.filter(({ url }) => !allowed(url));
    console.log(
      `test:e2e:web: network: ${counted.length} request(s) from the extension host and our ` +
        `webviews, ${foreign.length} to another origin`,
    );
    for (const { url, from } of foreign) console.error(`test:e2e:web: network: ${url} (${from})`);
    if (process.env.CHR_WEB_E2E_VERBOSE) {
      for (const { url, from } of counted) console.log(`network: ${url} (${from})`);
    }
    if (counted.length === 0) {
      console.error('test:e2e:web: network: no request recorded; the recorder is not working');
      return 1;
    }
    return foreign.length > 0 ? 1 : code;
  } finally {
    await browser.close();
    server.dispose();
  }
}

/** Criterion 8 through the browser page: opens the command palette, types `filter`, and writes the
 *  rows it lists (their aria labels) to `answerFile` for the suite to read (suite/palette.ts). */
async function checkPalette(page, filter, answerFile) {
  let answer;
  try {
    await page.keyboard.press('F1');
    const input = page.locator('.quick-input-widget input');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(`>${filter}`);
    // The list settles once the filter applies; read it after it stops changing.
    let labels = [];
    for (let stable = 0, last = ''; stable < 3;) {
      await page.waitForTimeout(300);
      labels = await page
        .locator('.quick-input-list .monaco-list-row')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label') ?? ''));
      const now = JSON.stringify(labels);
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    await page.keyboard.press('Escape');
    answer = { filter, labels };
  } catch (error) {
    answer = { filter, error: String(error) };
  }
  writeFileSync(answerFile, JSON.stringify(answer));
}

const vsixFiles = readdirSync(packageDir).filter((f) => f.endsWith('.vsix'));
if (vsixFiles.length !== 1) {
  fail(
    `expected exactly one .vsix in ${packageDir}, found ${vsixFiles.length}; run \`CHR_TEST_HOOKS=1 pnpm package\` first.`,
  );
}
if (probe && process.env.VSCODE_EXECUTABLE_PATH) {
  fail('--probe runs on the CI route only: the local route has no browser page to record');
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

  const bundle = path.join(packageDir, 'dist-test', 'web', probe ? 'probe.js' : 'suite.js');
  await build({
    entryPoints: [path.join(here, 'suite', probe ? 'probe.ts' : 'index.ts')],
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

  const workspace = path.join(work, 'workspace');
  makeWorkspace(workspace);

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
    console.log('test:e2e:web: CI route, @vscode/test-web with VS Code stable in Chromium');
    const code = await runInBrowser({ extensionPath, suite, workspace });
    if (code !== 0) throw new Error(`exit code ${code}`);
  }
  console.log('test:e2e:web: passed');
} catch (error) {
  console.error('test:e2e:web: failed', error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
// The test server's open connections would keep Node running.
process.exit();
