// Loads the fixture page with the shared offline fixture and nothing else: the page's own
// fetch('https://example.com') must fail this test.
import { expect, test } from '../../web/fixtures';

test('a page calling fetch(https://example.com) fails test:web', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('settled');
});
