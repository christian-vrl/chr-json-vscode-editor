// `pnpm test:web` sample (001 T6, T8): app-shell's Vite build loads from the local server, and the
// offline fixture aborts requests to any other origin, remote or local, as net::ERR_BLOCKED_BY_CLIENT.
import { BLOCKED_BY_CLIENT, expect, test } from './fixtures';

test('serves the app-shell sample page with no request leaving the local origin', async ({
  page,
  blockedRequests,
}) => {
  await page.goto('/');
  await expect(page.locator('#app .jse-main')).toBeVisible();
  expect(blockedRequests).toEqual([]);
});

test('serves the page under the webview CSP, with the library stylesheet applied', async ({
  page,
}) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  // The editor page compiles the query engine's WebAssembly (spec 011 criterion 9); nothing else.
  expect(csp).toMatch(/^default-src 'none'; script-src 'nonce-[^']+' 'wasm-unsafe-eval';/);
  expect(csp).not.toMatch(/unsafe-inline|'unsafe-eval'/);
  // vanilla-jsoneditor's own rule, now loaded from the stylesheet file instead of an inline <style>.
  await expect(page.locator('.jse-main')).toHaveCSS('min-height', '150px');
});

test("serves the compare and CSV pages under 003 criterion 6's policy exactly", async ({
  page,
}) => {
  for (const file of ['compare.html', 'csv.html']) {
    const response = await page.goto(`/${file}`);
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/^default-src 'none'; script-src 'nonce-[^']+'; style-src /);
  }
});

test.describe('a page that tries to leave the local origin', () => {
  // These tests make foreign requests on purpose; any other test fails if it does (001 T8).
  // The webview CSP would refuse the fetch before the fixture saw it, so it is off here.
  test.use({ expectBlockedRequests: true, webviewCsp: false });

  for (const url of ['https://example.com/', 'http://127.0.0.1:9/']) {
    test(`is blocked by the client: ${url}`, async ({ page, blockedRequests }) => {
      await page.goto('/');
      const failure = page.waitForEvent('requestfailed', (request) => request.url() === url);
      const outcome = await page.evaluate(async (target) => {
        try {
          await fetch(target, { mode: 'no-cors' });
          return 'reached';
        } catch {
          return 'failed';
        }
      }, url);
      expect(outcome).toBe('failed');
      // Only the route's abort yields this error (Chromium appends `.Inspector` when DevTools
      // interception blocks it); a request let through fails differently or not at all.
      expect((await failure).failure()?.errorText).toMatch(BLOCKED_BY_CLIENT);
      expect(blockedRequests).toEqual([url]);
    });
  }
});
