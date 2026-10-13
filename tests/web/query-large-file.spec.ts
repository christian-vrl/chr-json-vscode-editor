// Spec 011 criterion 11 (011 T6, UNK-049 ★) and spec 014 criterion 8 (014 T4, UNK-065 ★) on the
// standalone page: above 5 MiB, measured as the document text's UTF-8 length when the Transform
// dialog opens, the dialog leaves JavaScript, Lodash and JSONPath (RFC 9535) out and does not load
// the JavaScript engine; at or below it every language is listed. The size is the text's now, not
// the size the tab opened with: an unlocked large-file tab whose text shrank lists them again, and a
// normal tab whose text grew past the threshold does not. The page's host sends the text
// (`externalChange`), as another editor would; the e2e suite (queryLargeFile.cjs) proves the same
// in VS Code on 008's 6 MiB fixture.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const LIMIT = 5 * 2 ** 20;
const SIX_MIB = 6 * 2 ** 20;
const GATED = ['JavaScript', 'Lodash', 'JSONPath (RFC 9535)'];

const modal = (page: Page) => page.locator('dialog.jse-transform-modal');

/** A JSON array whose text is exactly `bytes` bytes, every byte ASCII; its first item says
 *  `marker`. */
function arrayText(bytes: number, marker: string): string {
  const head = `[\n  {"marker": "${marker}"},\n`;
  const line = '  {"id": 1, "name": "alpha"},\n';
  const tail = '  {"id": 2}\n]\n';
  const count = Math.floor((bytes - head.length - tail.length) / line.length);
  const body = head + line.repeat(count);
  return body + ' '.repeat(bytes - body.length - tail.length) + tail;
}

/** Plays another editor replacing the document with `text`; waits until the editor shows it. */
async function setText(page: Page, text: string, marker: string, mode = 'tree'): Promise<void> {
  await page.evaluate((next) => window.devHost!.externalChange(next), text);
  await expect(page.locator(`.jse-${mode}-mode`)).toContainText(marker);
}

/** Opens Transform from the main menu and returns the languages it lists and the selected one;
 *  closes the dialog. */
async function languages(page: Page, mode = 'tree') {
  await page.locator(`.jse-${mode}-mode .jse-transform`).click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('.jse-config').click();
  await expect(page.locator('.jse-query-language').first()).toBeVisible();
  const listed = await page.locator('.jse-query-language').allTextContents();
  const selected = await page.locator('.jse-query-language.selected').allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.locator('.jse-query-language')).toHaveCount(0);
  await modal(page).locator('.jse-close').click();
  await expect(modal(page)).toHaveCount(0);
  const trim = (names: string[]) => names.map((name) => name.trim());
  return { listed: trim(listed), selected: trim(selected) };
}

/** Picks `language` in Transform and closes the dialog. */
async function pick(page: Page, language: string): Promise<void> {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await modal(page).locator('.jse-config').click();
  await page.locator('.jse-query-language', { hasText: language }).click();
  await expect(modal(page).locator('.jse-description')).toContainText(language);
  await modal(page).locator('.jse-close').click();
  await expect(modal(page)).toHaveCount(0);
}

const engineMarks = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .map((mark) => mark.name)
      .filter((name) => name.includes('engine')),
  );

test('a normal tab lists every language up to 5 MiB and leaves the engine ones out above it', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
  await setText(page, arrayText(LIMIT, 'at'), 'at');
  const all = (await languages(page)).listed;
  expect(all).toEqual(expect.arrayContaining(['JSONQuery', 'JMESPath', ...GATED]));
  const allowed = all.filter((name) => !GATED.includes(name));

  // Lodash picked at the threshold; one byte more and it is not listed, nor selected.
  await pick(page, 'Lodash');
  await setText(page, arrayText(LIMIT + 1, 'grown'), 'grown');
  expect(await languages(page)).toEqual({ listed: allowed, selected: ['JSONQuery'] });

  // Back at the threshold, Lodash is listed and selected again.
  await setText(page, arrayText(LIMIT, 'shrunk'), 'shrunk');
  expect(await languages(page)).toEqual({ listed: all, selected: ['Lodash'] });
});

test('text mode measures the text as typed', async ({ page }) => {
  await page.goto('/?mode=text');
  await expect(page.locator('.jse-text-mode')).toContainText('COBOL');
  await setText(page, arrayText(LIMIT, 'start'), 'start', 'text');
  const all = (await languages(page, 'text')).listed;
  expect(all).toEqual(expect.arrayContaining(GATED));
  // One more byte typed into the text, not yet sent to the host.
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(' ');
  const { listed } = await languages(page, 'text');
  expect(listed).toEqual(all.filter((name) => !GATED.includes(name)));
});

test('a large-file tab unlocked lists no engine language and loads no engine until it shrinks', async ({
  page,
}) => {
  await page.goto(`/?largeFile=${SIX_MIB}&unlocked=1`);
  await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
  await setText(page, arrayText(SIX_MIB, 'six'), 'six');
  const { listed } = await languages(page);
  expect(listed).toEqual(expect.arrayContaining(['JSONQuery', 'JMESPath', 'JSONPath (Goessner)']));
  expect(listed.filter((name) => GATED.includes(name))).toEqual([]);
  expect(await engineMarks(page)).toEqual([]);

  await setText(page, '[{"marker": "small"}]\n', 'small');
  const shrunk = await languages(page);
  expect(shrunk.listed).toEqual(expect.arrayContaining(GATED));
  expect(shrunk.listed.filter((name) => !GATED.includes(name))).toEqual(listed);
  expect(await engineMarks(page)).toContain('chr:query-engine-compiled');
});

test('a locked large-file tab offers no Transform', async ({ page }) => {
  await page.goto(`/?largeFile=${SIX_MIB}`);
  await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
  await expect(page.locator('.jse-tree-mode .jse-menu')).toBeVisible();
  await expect(page.locator('.jse-transform')).toHaveCount(0);
});
