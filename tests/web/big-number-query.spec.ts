// Spec 015 B7 and B8 (015 T5) on the standalone page: every Transform language keeps big numbers
// exact. A query that passes big ids through writes their digits back to the document; a result whose
// numbers can't be told apart (two big ids with one nearest number) shows B7's message in the preview
// with Transform disabled, and nothing reaches the host. The unit cases are tests/query/'s (criteria 8
// and 9); this is the dialog around them.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const IDS = '[22345678901234567890, 7, 12345678901234567890]';
const SAME_NEAREST = '[12345678901234567890, 12345678901234567891]';
const AMBIGUOUS = "Error: 2 numbers in this result can't be kept exact.";

const modal = (page: Page) => page.locator('dialog.jse-transform-modal');
const queryBox = (page: Page) => modal(page).locator('textarea.jse-query');
const transformButton = (page: Page) =>
  modal(page).getByRole('button', { name: 'Transform', exact: true });
const previewData = (page: Page) => modal(page).locator('.jse-preview-data');
const previewError = (page: Page) => modal(page).locator('.jse-preview.jse-error');

async function open(page: Page, text: string): Promise<void> {
  await page.goto(`/?mode=tree&text=${encodeURIComponent(text)}`);
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
}

/** Opens Transform, picks `language` and types `query`. */
async function transformWith(page: Page, language: string, query: string): Promise<void> {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('.jse-config').click();
  await page.locator('.jse-query-language', { hasText: language }).click();
  await queryBox(page).fill(query);
}

/** Each language with a query keeping the two big ids, and one returning the ambiguous pair as it
 *  is. Where the language can build a value, the kept ids go into a new object, so the edit carries
 *  them as values; JSONPath selects nodes, so its edit removes the item it drops. */
const LANGUAGES = [
  { language: 'JSONQuery', keep: '{ kept: sort() }', all: 'sort()', values: true },
  { language: 'JMESPath', keep: '{kept: sort(@)}', all: '@', values: true },
  { language: 'JSONPath (RFC 9535)', keep: '$[?@ > 8]', all: '$[*]', values: false },
  { language: 'JSONPath (Goessner)', keep: '$[?(@ > 8)]', all: '$[*]', values: false },
  {
    language: 'JavaScript',
    keep: 'function query (data) {\n  return { kept: data.filter(d => d > 8) }\n}',
    all: '',
    values: true,
  },
  {
    language: 'Lodash',
    keep: 'function query (data) {\n  return { kept: _.sortBy(data) }\n}',
    all: '',
    values: true,
  },
];

/** The edits the page sent the host, as JSON. The dev host keeps a structured clone of each, in
 *  which a big number is a plain object holding `isLosslessNumber` and its digits as `value`. (It
 *  writes its own text with `JSON.stringify`, which the extension host never does, so the edit is
 *  what is checked here; bigNumbers.cjs and core's golden cases check the bytes written.) */
const sentEdits = (page: Page) =>
  page.evaluate(() => JSON.stringify(window.devHost!.edits.map((edit) => edit.change)));

for (const { language, keep, all, values } of LANGUAGES) {
  test(`${language}: big ids come back with their digits`, async ({ page }) => {
    await open(page, IDS);
    await transformWith(page, language, keep);
    await expect(previewData(page)).toContainText('22345678901234567890');
    await expect(previewData(page)).toContainText('12345678901234567890');
    await transformButton(page).click();
    await expect(modal(page)).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.devHost!.edits.length)).toBe(1);
    const edits = await sentEdits(page);
    // Not the nearest numbers, as JavaScript writes them.
    expect(edits).not.toContain('22345678901234570000');
    expect(edits).not.toContain('12345678901234567000');
    if (values) {
      expect(edits).toContain('"value":"22345678901234567890"');
      expect(edits).toContain('"value":"12345678901234567890"');
    } else {
      expect(edits).toBe('[{"kind":"patch","patch":[{"op":"remove","path":"/1"}]}]');
    }
  });

  // JavaScript and Lodash hand both big numbers back as the engine's own objects, so their results
  // are exact (B8); only the library languages round them (B7).
  if (language === 'JavaScript' || language === 'Lodash') continue;

  test(`${language}: an ambiguous result disables Transform and sends nothing`, async ({
    page,
  }) => {
    await open(page, SAME_NEAREST);
    await transformWith(page, language, all);
    await expect(previewError(page)).toHaveText(AMBIGUOUS);
    await expect(transformButton(page)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    expect(await page.evaluate(() => window.devHost!.edits.length)).toBe(0);
    expect(await page.evaluate(() => window.devHost!.text)).toBe(SAME_NEAREST);
  });
}

test('JavaScript and Lodash keep two big ids with one nearest number apart', async ({ page }) => {
  for (const language of ['JavaScript', 'Lodash']) {
    await open(page, SAME_NEAREST);
    await transformWith(
      page,
      language,
      'function query (data) {\n  return { swapped: data.slice().reverse() }\n}',
    );
    await expect(previewData(page)).toContainText('12345678901234567891');
    await transformButton(page).click();
    await expect.poll(() => page.evaluate(() => window.devHost!.edits.length)).toBe(1);
    expect(await sentEdits(page)).toMatch(
      /"value":"12345678901234567891"[^\]]*"value":"12345678901234567890"/,
    );
  }
});
