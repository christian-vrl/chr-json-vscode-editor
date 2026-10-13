// Spec 010 criterion 7 (010 T3) on the standalone page: text mode's menu shows "Smart format"
// between Format and Compact; clicking it sends the `smartFormat` action, and the page's host runs
// core's smartFormat on it as the extension host does, so the text becomes the e2e fixture's
// expected bytes. The tree and table menus are unchanged.
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const FIXTURES = path.resolve(__dirname, '../e2e/fixtures/smart-format');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

const changesOf = (page: Page) => page.evaluate(() => window.devHost!.edits.map((e) => e.change));
const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);
/** The class names of the buttons in the main menu of `mode`, in order. */
const menuButtons = (page: Page, mode: string) =>
  page
    .locator(`.jse-${mode}-mode .jse-menu`)
    .first()
    .locator('button')
    .evaluateAll((buttons: Element[]) => buttons.map((b) => b.className));

async function open(page: Page, text: string, mode: 'tree' | 'text' | 'table') {
  await page.goto(`/?mode=${mode}&text=${encodeURIComponent(text)}`);
  await expect(page.locator(`.jse-${mode}-mode`)).toBeVisible();
}

for (const format of ['json', 'jsonc', 'json5'] as const) {
  test(`text mode: "Smart format" lays out input.${format} as expected.${format}`, async ({
    page,
  }) => {
    await open(page, fixture(`input.${format}`), 'text');
    if (format !== 'json') await page.evaluate((f) => window.devHost!.setFormat(f), format);
    const button = page.locator('.jse-text-mode .chr-smart-format');
    await expect(button).toHaveAttribute('title', /^Smart format/);
    await button.click();
    await expect.poll(() => hostText(page)).toBe(fixture(`expected.${format}`));
    await expect(page.locator('.jse-text-mode .cm-content')).toContainText(
      fixture(`expected.${format}`).split('\n')[2]!.trim(),
    );
    expect(await changesOf(page)).toEqual([{ kind: 'action', action: { name: 'smartFormat' } }]);
  });
}

test('text mode: "Smart format" sits between Format and Compact', async ({ page }) => {
  await open(page, fixture('input.json'), 'text');
  const classes = (await menuButtons(page, 'text')).map((c) =>
    c.includes('jse-format')
      ? 'format'
      : c.includes('chr-smart-format')
        ? 'smart'
        : c.includes('jse-compact')
          ? 'compact'
          : undefined,
  );
  const order = classes.filter(Boolean);
  expect(order).toEqual(['format', 'smart', 'compact']);
  const all = await menuButtons(page, 'text');
  const at = all.findIndex((c) => c.includes('chr-smart-format'));
  expect(all[at - 1]).toContain('jse-format');
  expect(all[at + 1]).toContain('jse-compact');
});

for (const mode of ['tree', 'table'] as const) {
  test(`${mode} mode: the menu has no "Smart format"`, async ({ page }) => {
    await open(page, fixture('input.json'), mode);
    const buttons = await menuButtons(page, mode);
    expect(buttons.some((c) => c.includes('jse-sort'))).toBe(true);
    expect(buttons.some((c) => c.includes('chr-smart-format'))).toBe(false);
  });
}
