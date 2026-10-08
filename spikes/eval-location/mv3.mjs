// pnpm --filter chr-json-editor-spike-eval-location spike:mv3 (spike 004 T1): is option A's frame
// reusable as an MV3 sandbox page? Builds an unpacked MV3 extension whose manifest lists the frame
// under `sandbox.pages`, loads it in Playwright's Chromium, runs the benchmark through an extension
// page, and writes results/mv3-chromium.json. Frame pages tried: the VS Code sandbox.html byte for
// byte; the same sandbox.js under an HTML wrapper with no <meta> CSP (the manifest's sandbox CSP
// then applies alone); and that wrapper not listed under sandbox.pages (negative control).
//
// Chromium comes from Playwright; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use another build.
/* global window, chrome -- browser globals inside page.evaluate / waitForFunction callbacks */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { describeFixture } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const built = spawnSync(process.execPath, ['build.mjs'], { cwd: here, stdio: 'inherit' });
if (built.status !== 0) process.exit(1);

const work = mkdtempSync(path.join(tmpdir(), 'chr-spike-mv3-'));
const ext = path.join(work, 'extension');
mkdirSync(ext);
let context;
try {
  const fixture = describeFixture();
  writeFileSync(path.join(ext, 'doc.json'), fixture.text);
  writeFileSync(path.join(ext, 'schema.json'), JSON.stringify(fixture.schema));
  for (const file of ['sandbox.html', 'sandbox.js', 'mv3-page.js']) {
    copyFileSync(path.join(here, 'dist', file), path.join(ext, file));
  }
  writeFileSync(
    path.join(ext, 'sandbox-plain.html'),
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>CHR JSON Editor sandbox</title>\n</head>\n<body>\n<script src="sandbox.js"></script>\n</body>\n</html>\n',
  );
  // Negative control: the same page not listed under sandbox.pages gets the extension-page CSP,
  // which forbids eval, so it must fail.
  copyFileSync(path.join(ext, 'sandbox-plain.html'), path.join(ext, 'sandbox-unlisted.html'));
  writeFileSync(
    path.join(ext, 'page.html'),
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>spike</title></head>\n<body>\n<script src="mv3-page.js"></script>\n</body>\n</html>\n',
  );
  // The default MV3 sandbox CSP is used (no content_security_policy key), so this is what a plain
  // MV3 extension gets.
  writeFileSync(
    path.join(ext, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'CHR JSON Editor eval-location spike',
        version: '0.0.0',
        sandbox: { pages: ['sandbox.html', 'sandbox-plain.html'] },
      },
      null,
      2,
    ),
  );

  // Node reference: the same Ajv routine outside the browser.
  const ref = path.join(work, 'reference');
  mkdirSync(ref);
  writeFileSync(path.join(ref, 'doc.json'), fixture.text);
  writeFileSync(path.join(ref, 'fixture.json'), JSON.stringify({ schema: fixture.schema }));
  const referenceRun = spawnSync(process.execPath, ['dist/node-reference.mjs', ref], {
    cwd: here,
    stdio: 'inherit',
  });
  if (referenceRun.status !== 0) throw new Error('node reference failed');
  const reference = JSON.parse(readFileSync(path.join(ref, 'node-reference.json'), 'utf8')).errors;

  context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const page = await context.newPage();
  // The spike extension has no background worker to read its ID from; ask chrome://extensions.
  const id = await extensionId(page);

  const frames = {};
  for (const frame of ['sandbox.html', 'sandbox-plain.html', 'sandbox-unlisted.html']) {
    const violations = [];
    page.removeAllListeners('console');
    page.on('console', (m) => violations.push(m.text()));
    await page.goto(`chrome-extension://${id}/page.html?frame=${frame}`);
    await page.waitForFunction(() => window.spikeResult !== undefined, null, { timeout: 60_000 });
    const result = await page.evaluate(() => window.spikeResult);
    const errorsMatch =
      result.errors !== null && JSON.stringify(result.errors) === JSON.stringify(reference);
    const median = (v) =>
      v.length
        ? Math.round([...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] * 10) / 10
        : null;
    frames[frame] = {
      validates: !result.error && errorsMatch,
      error: result.error ?? null,
      errorCount: result.errors ? result.errors.length : null,
      errorsMatchNodeReference: errorsMatch,
      compileMs: result.compileMs === null ? null : Math.round(result.compileMs * 10) / 10,
      totalMsMedian: median(result.totalMs),
      validateMsMedian: median(result.validateMs),
      console: violations,
    };
    console.log(`${frame}: validates=${frames[frame].validates} ${result.error ?? ''}`);
  }
  const browserVersion =
    context.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent));
  mkdirSync(path.join(here, 'results'), { recursive: true });
  writeFileSync(
    path.join(here, 'results', 'mv3-chromium.json'),
    `${JSON.stringify(
      {
        spike: '004-T1',
        browser: browserVersion,
        manifest: JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8')),
        fixture: {
          bytes: fixture.bytes,
          items: fixture.items,
          rules: fixture.rules,
          sha256: fixture.sha256,
        },
        frames,
      },
      null,
      2,
    )}\n`,
  );
  console.log('spike:mv3: done');
} catch (error) {
  console.error('spike:mv3: failed', error);
  process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(work, { recursive: true, force: true });
}

async function extensionId(page) {
  await page.goto('chrome://extensions');
  const id = await page.evaluate(async () => {
    // chrome.developerPrivate is available on chrome://extensions.
    const all = await new Promise((resolve) => chrome.developerPrivate.getExtensionsInfo(resolve));
    return all.find((e) => e.name === 'CHR JSON Editor eval-location spike')?.id;
  });
  if (!id) throw new Error('spike extension did not load');
  return id;
}
