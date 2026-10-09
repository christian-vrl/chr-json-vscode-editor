// 003 T7 follow-up (review finding F1) on the standalone page: while a key or value is typed inline
// (tree or table mode) or into one of the library's inputs, the undo and redo keys undo that typing
// in the field, as the browser does it, and do not reach the host's history. They still never reach
// the library or the page around it (VS Code's webview frame forwards the keys it sees to the
// workbench). Elsewhere, including tree and table mode's hidden key input and text mode's document
// editor, the keys stay the host's (undo.spec.ts).
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

declare global {
  interface Window {
    /** Undo and redo keys that got past the editor to the window's bubble phase. */
    leakedKeys?: string[];
  }
}

const historyOf = (page: Page) => page.evaluate(() => [...window.devHost!.history]);
const editsOf = (page: Page) => page.evaluate(() => window.devHost!.edits.length);
const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);
const leakedKeys = (page: Page) => page.evaluate(() => [...window.leakedKeys!]);

/** Opens the page and records undo and redo keys that reach the window after the editor. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => {
    window.leakedKeys = [];
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && /^[yz]$/i.test(e.key)) window.leakedKeys!.push(e.key);
    });
  });
}

/** Types `typed` over what `field` holds, then undoes and redoes it with every binding. */
async function undoRedoTyping(page: Page, field: Locator, original: string, typed: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(typed);
  await expect(field).toHaveText(typed);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(field).toHaveText(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(field).toHaveText(typed);
  if (process.platform !== 'darwin') {
    // Chromium binds Ctrl+Y to redo outside macOS only.
    await page.keyboard.press('Control+z');
    await expect(field).toHaveText(original);
    await page.keyboard.press('Control+y');
    await expect(field).toHaveText(typed);
  }
  expect(await historyOf(page)).toEqual([]);
  expect(await editsOf(page)).toBe(0);
  expect(await leakedKeys(page)).toEqual([]);
}

test('undo and redo in a tree value being edited act on its typing, not the document', async ({
  page,
}) => {
  await open(page, '/');
  const tree = page.locator('.jse-tree-mode');
  await tree.getByText('COBOL', { exact: true }).dblclick();
  const field = tree.locator('.jse-editable-div');
  await expect(field).toBeFocused();
  await undoRedoTyping(page, field, 'COBOL', 'Fortran');

  // Committed, the edit is the document's; focus is back in the tree, where undo is the host's.
  await page.keyboard.press('Enter');
  await expect.poll(() => hostText(page)).toContain('Fortran');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => historyOf(page)).toEqual(['undo']);
  await expect.poll(() => hostText(page)).not.toContain('Fortran');
  expect(await leakedKeys(page)).toEqual([]);
});

test('undo and redo in a tree key being edited act on its typing', async ({ page }) => {
  await open(page, '/');
  const tree = page.locator('.jse-tree-mode');
  await tree.getByText('language', { exact: true }).nth(1).dblclick();
  const field = tree.locator('.jse-editable-div');
  await expect(field).toBeFocused();
  await undoRedoTyping(page, field, 'language', 'tongue');
});

test('undo and redo in a table cell being edited act on its typing', async ({ page }) => {
  await open(page, '/?mode=table');
  const table = page.locator('.jse-table-mode');
  await table.getByText('COBOL', { exact: true }).dblclick();
  const field = table.locator('.jse-editable-div');
  await expect(field).toBeFocused();
  await undoRedoTyping(page, field, 'COBOL', 'Fortran');
});

test("undo in tree mode's search box acts on its typing", async ({ page }) => {
  await open(page, '/');
  const tree = page.locator('.jse-tree-mode');
  await tree.getByText('COBOL', { exact: true }).click();
  await page.keyboard.press('ControlOrMeta+f');
  const search = tree.locator('.jse-search-input');
  await expect(search).toBeFocused();
  await page.keyboard.type('Grace');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(search).toHaveValue('');
  expect(await historyOf(page)).toEqual([]);
  expect(await leakedKeys(page)).toEqual([]);
});

test("undo in text mode's search box acts on its typing, not the document", async ({ page }) => {
  await open(page, '/?mode=text');
  const editor = page.locator('.jse-text-mode .cm-content');
  await editor.click();
  const before = await hostText(page);
  await page.keyboard.press('ControlOrMeta+f');
  const search = page.locator('.jse-text-mode .cm-search input[name="search"]');
  await expect(search).toBeFocused();
  await page.keyboard.type('Grace');
  await page.keyboard.press('ControlOrMeta+z');
  // CodeMirror's panel handles each input event, so the browser's undo takes back the typing in
  // smaller steps than in a plain input: some of it, from the end.
  await expect.poll(() => search.inputValue()).not.toBe('Grace');
  expect('Grace'.startsWith(await search.inputValue())).toBe(true);
  expect(await hostText(page)).toBe(before);
  expect(await historyOf(page)).toEqual([]);
  expect(await leakedKeys(page)).toEqual([]);
});

test('Cmd+Z and Cmd+Shift+Z (macOS) follow the same split', async ({ page }) => {
  await open(page, '/');
  const tree = page.locator('.jse-tree-mode');
  await tree.getByText('COBOL', { exact: true }).dblclick();
  await expect(tree.locator('.jse-editable-div')).toBeFocused();
  // In the field: not the host's, and kept from the library and the page.
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+Shift+z');
  expect(await historyOf(page)).toEqual([]);
  await page.keyboard.press('Escape');
  // In the tree (its hidden key input): the host's.
  await expect(tree.locator('.jse-hidden-input')).toBeFocused();
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(() => historyOf(page)).toEqual(['undo', 'redo']);
  expect(await leakedKeys(page)).toEqual([]);
});
