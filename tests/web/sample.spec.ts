// `pnpm test:web` sample (001 T6): app-shell's Vite build loads from the local server, and the
// offline fixture aborts requests to any other origin, remote or local.
import { expect, test } from './fixtures';

test('serves the app-shell sample page with no request leaving the local origin', async ({
  page,
  blockedRequests,
}) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText('@chr-json-editor/app-shell');
  expect(blockedRequests).toEqual([]);
});

for (const url of ['https://example.com/', 'http://127.0.0.1:9/']) {
  test(`aborts a request to another origin: ${url}`, async ({ page, blockedRequests }) => {
    await page.goto('/');
    const outcome = await page.evaluate(async (target) => {
      try {
        await fetch(target);
        return 'reached';
      } catch {
        return 'failed';
      }
    }, url);
    expect(outcome).toBe('failed');
    expect(blockedRequests).toEqual([url]);
  });
}
