// `pnpm test:web` sample (001 T6, T8): app-shell's Vite build loads from the local server, and the
// offline fixture aborts requests to any other origin, remote or local, as net::ERR_BLOCKED_BY_CLIENT.
import { BLOCKED_BY_CLIENT, expect, test } from './fixtures';

test('serves the app-shell sample page with no request leaving the local origin', async ({
  page,
  blockedRequests,
}) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText('@chr-json-editor/app-shell');
  expect(blockedRequests).toEqual([]);
});

test.describe('a page that tries to leave the local origin', () => {
  // These tests make foreign requests on purpose; any other test fails if it does (001 T8).
  test.use({ expectBlockedRequests: true });

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
