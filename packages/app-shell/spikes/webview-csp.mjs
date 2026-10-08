// Spike for UNK-029 (003 T2): does the standalone page work under the webview CSP from 003 T4
// (packages/vscode-extension/src/webviewHtml.ts)? Serves the built page (run `pnpm build` first)
// with that CSP as a response header, tags our own <script>/<link> with the nonce (as
// renderWebviewHtml does) and drops index.html's inline <style>; then counts CSP violations,
// switches tree/text/table, and checks whether the library's own CSS applied. The local origin
// stands in for `webview.cspSource`. Run from the repo root with Chromium available to
// Playwright (PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, as for test:web):
//   node packages/app-shell/spikes/webview-csp.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { contentSecurityPolicy } from '../../vscode-extension/src/webviewHtml.ts';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4173';
const nonce = 'c3Bpa2Utbm9uY2UtMDAx';
const csp = contentSecurityPolicy(origin, nonce);

const server = await preview({ root: pkg, logLevel: 'error' });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  await page.route(`${origin}/`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/<(script|link) /g, `<$1 nonce="${nonce}" `);
    await route.fulfill({
      response,
      body: html,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  await page.addInitScript(() => {
    globalThis.violations = [];
    globalThis.document.addEventListener('securitypolicyviolation', (e) =>
      globalThis.violations.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${origin}/`);
  const toolbar = page.getByRole('toolbar', { name: 'Editor' });
  const modes = {};
  for (const [label, root] of [
    ['Text', '.jse-text-mode'],
    ['Table', '.jse-table-mode'],
    ['Tree', '.jse-tree-mode'],
  ]) {
    await toolbar.getByRole('button', { name: label }).click();
    modes[label] = await page
      .locator(root)
      .waitFor({ timeout: 5000 })
      .then(() => 'shown')
      .catch(() => 'missing');
  }
  const violations = await page.evaluate(() => globalThis.violations);
  const byKind = {};
  for (const v of violations) byKind[v] = (byKind[v] ?? 0) + 1;

  console.log(`CSP: ${csp}`);
  console.log('violations:', byKind);
  console.log('page errors:', errors);
  console.log('modes:', modes);
  // vanilla-jsoneditor's own stylesheet sets `.jse-main { min-height: 150px }`; unstyled is `0px`.
  const minHeight = await page
    .locator('.jse-main')
    .evaluate((el) => globalThis.getComputedStyle(el).minHeight);
  console.log(`.jse-main min-height: ${minHeight} (150px when the library's CSS applies)`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
