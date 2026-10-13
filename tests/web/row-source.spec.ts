// The editor's answer to "Export to CSV…" (spec 009 criterion 7, 009 T4) on the standalone page,
// with real clicks: the page's host asks `getRowSource` as the extension host does, and the editor
// names the one value tree mode has selected, or `''` for the document's data (a key, two rows, or
// table mode, which shows the root array). The e2e suite (csv.cjs) checks what the host does with
// the answer.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DOC = JSON.stringify({
  people: [
    { name: 'Ada', language: 'COBOL' },
    { name: 'Grace', language: 'COBOL' },
  ],
  count: 2,
});

const rowSource = (page: Page) => page.evaluate(() => window.devHost!.requestRowSource());
const node = (page: Page, pointer: string) =>
  page.locator(`.jse-json-node[data-path="${encodeURIComponent(pointer)}"]`).first();

test.beforeEach(async ({ page }) => {
  await page.goto(`/?text=${encodeURIComponent(DOC)}`);
  await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
});

test('tree mode names the one array or object selected, else the document', async ({ page }) => {
  expect(await rowSource(page)).toBe('');
  await node(page, '/people').locator('.jse-header .jse-bracket').first().click();
  expect(await rowSource(page)).toBe('/people');
  await node(page, '/people/1').locator('.jse-header .jse-bracket').first().click();
  expect(await rowSource(page)).toBe('/people/1');
  // A key is not a value.
  await node(page, '/count').locator('.jse-key').click();
  expect(await rowSource(page)).toBe('');
  // Two rows selected: not one value.
  await node(page, '/people/0').locator('.jse-header .jse-bracket').first().click();
  await node(page, '/people/1')
    .locator('.jse-header .jse-bracket')
    .first()
    .click({
      modifiers: ['Shift'],
    });
  expect(await rowSource(page)).toBe('');
});

test('table and text mode name the document', async ({ page }) => {
  await node(page, '/people').locator('.jse-header .jse-bracket').first().click();
  expect(await rowSource(page)).toBe('/people');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('.jse-table-mode')).toBeVisible();
  expect(await rowSource(page)).toBe('');
  await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Text' }).click();
  await expect(page.locator('.jse-text-mode')).toBeVisible();
  expect(await rowSource(page)).toBe('');
});
