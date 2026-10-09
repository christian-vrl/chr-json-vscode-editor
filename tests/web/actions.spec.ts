// 003 T8 on the standalone page: the library's whole-document buttons, shortcuts and repair prompts
// reach the host as core's actions (format, compact, sort, repair) or as data (transform), never as
// text the library wrote, so comments and style are kept. The page's host runs core like the
// extension host does. The e2e suite proves the documents' bytes in VS Code
// (packages/vscode-extension/test/e2e/actions.cjs); this suite covers the routes it does not take.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const changesOf = (page: Page) => page.evaluate(() => window.devHost!.edits.map((e) => e.change));
const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);

async function open(page: Page, text: string, mode: 'tree' | 'text') {
  await page.goto(`/?mode=${mode}&text=${encodeURIComponent(text)}`);
  await expect(page.locator(`.jse-${mode}-mode`)).toBeVisible();
}

test('text mode: Ctrl+I and Ctrl+Shift+I run format and compact, keeping comments', async ({
  page,
}) => {
  await open(page, '{"a": 1, // one\n"b": [2]}', 'text');
  await page.locator('.jse-text-mode .cm-content').click();
  await page.keyboard.press('ControlOrMeta+i');
  await expect.poll(() => hostText(page)).toBe('{\n  "a": 1, // one\n  "b": [\n    2\n  ]\n}');
  await expect(page.locator('.jse-text-mode .cm-content')).toContainText('// one');
  await page.keyboard.press('ControlOrMeta+Shift+i');
  await expect.poll(() => hostText(page)).toBe('{"a":1,/* one */"b":[2]}');
  expect(await changesOf(page)).toEqual([
    { kind: 'action', action: { name: 'format' } },
    { kind: 'action', action: { name: 'compact' } },
  ]);
});

test('text mode: the menu sends typing first, then the action on the text as typed', async ({
  page,
}) => {
  await open(page, '{"a": 1}', 'text');
  await page.locator('.jse-text-mode .cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' // typed');
  await page.locator('.jse-text-mode .jse-format').click();
  await expect.poll(() => hostText(page)).toBe('{\n  "a": 1\n} // typed');
  const changes = await changesOf(page);
  expect(changes.at(-1)).toEqual({ kind: 'action', action: { name: 'format' } });
  expect(changes.slice(0, -1)).toEqual([{ kind: 'text', text: '{"a": 1} // typed' }]);
});

test('text mode: "Auto repair" runs core repair, which keeps comments', async ({ page }) => {
  await open(page, "{a: 1 // one\n'b': 2}", 'text');
  await page.getByRole('button', { name: 'Auto repair' }).first().click();
  await expect.poll(() => hostText(page)).toBe('{"a": 1, // one\n"b": 2}');
  expect(await changesOf(page)).toEqual([{ kind: 'action', action: { name: 'repair' } }]);
});

test('tree mode: accepting the repaired view repairs the document (repair on open)', async ({
  page,
}) => {
  await open(page, "{a: 1 // one\n'b': 2}", 'tree');
  await page.locator('.jse-tree-mode').getByRole('button', { name: 'Ok', exact: true }).click();
  await expect.poll(() => hostText(page)).toBe('{"a": 1, // one\n"b": 2}');
  expect(await changesOf(page)).toEqual([{ kind: 'action', action: { name: 'repair' } }]);
});

test('tree mode: an edit on the repaired view repairs first, then applies the edit', async ({
  page,
}) => {
  await open(page, "{a: 1 'b': 2}", 'tree');
  await page.locator('[data-path="%2Fb"] .jse-value').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect.poll(() => changesOf(page)).toHaveLength(2);
  expect(await changesOf(page)).toEqual([
    { kind: 'action', action: { name: 'repair' } },
    { kind: 'patch', patch: [{ op: 'replace', path: '/b', value: 3 }] },
  ]);
  // The page's host writes patches with JSON.stringify (dev-host-adapter.ts).
  await expect
    .poll(async () => JSON.parse(await hostText(page)) as unknown)
    .toEqual({ a: 1, b: 3 });
});

test('sort in tree mode goes as core sort with the new order', async ({ page }) => {
  await open(page, '{"b": 1, "c": 2, "a": 3}', 'tree');
  await page.locator('.jse-tree-mode .jse-sort').click();
  await page.locator('.jse-modal').getByRole('button', { name: 'Sort', exact: true }).click();
  await expect.poll(() => hostText(page)).toBe('{"a": 3, "b": 1, "c": 2}');
  expect(await changesOf(page)).toEqual([
    { kind: 'action', action: { name: 'sort', path: '', order: [2, 0, 1] } },
  ]);
});

test('text mode: sort goes as core sort; after a cancelled sort, typing goes as text', async ({
  page,
}) => {
  await open(page, '{"b": 1, "a": 2}', 'text');
  const sortDialog = page.locator('.jse-modal.jse-sort-modal');
  await page.locator('.jse-text-mode .jse-sort').click();
  await sortDialog.getByRole('button', { name: 'Sort', exact: true }).click();
  await expect.poll(() => hostText(page)).toBe('{"a": 2, "b": 1}');
  expect(await changesOf(page)).toEqual([
    { kind: 'action', action: { name: 'sort', path: '', order: [1, 0] } },
  ]);

  // Cancelled: the next text is typing, even when it only reorders the members.
  await page.locator('.jse-text-mode .jse-sort').click();
  await expect(sortDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sortDialog).toBeHidden();
  await page.locator('.jse-text-mode .cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('{"b": 1, "a": 2}');
  await expect.poll(() => hostText(page)).toBe('{"b": 1, "a": 2}');
  expect((await changesOf(page)).slice(1)).toEqual([{ kind: 'text', text: '{"b": 1, "a": 2}' }]);
});

test('transform offers JSONQuery, JMESPath and JSONPath (Goessner) only, and runs JSONPath', async ({
  page,
}) => {
  await open(page, '[{"n": 1}, {"n": 5}]', 'tree');
  await page.locator('.jse-tree-mode .jse-transform').click();
  const modal = page.locator('.jse-modal');
  await expect(modal.locator('.jse-description a').first()).toHaveAttribute(
    'href',
    /^https:\/\/jsonquerylang\.org/,
  );
  await modal.locator('.jse-config').click();
  await expect(page.locator('.jse-query-language')).toHaveText([
    'JSONQuery',
    'JMESPath',
    'JSONPath (Goessner)',
  ]);
  await page.locator('.jse-query-language', { hasText: 'JSONPath (Goessner)' }).click();
  await modal.locator('textarea.jse-query').fill('$[?(@.n > 2)]');
  await modal.getByRole('button', { name: 'Transform', exact: true }).click();
  // The page's host writes patches with JSON.stringify (dev-host-adapter.ts).
  await expect.poll(async () => JSON.parse(await hostText(page)) as unknown).toEqual([{ n: 5 }]);
  expect(await changesOf(page)).toEqual([{ kind: 'patch', patch: [{ op: 'remove', path: '/0' }] }]);
});
