// 003 T7 (spec 003 criterion 3) on the standalone page: undo and redo belong to the host's history,
// never the library's. The undo and redo keys and the library's menu buttons reach the host as
// `undo` and `redo` (DevHostAdapter.history), the library undoes nothing itself (no edit of its own
// follows the key), and the host's answer is what the editor shows. Text mode first hands the host
// the typing it holds back, so an undo undoes that typing, as in VS Code's text editor; a save's
// `flush` hands it over too. The e2e suite proves the same against VS Code's own undo stack and
// save (packages/vscode-extension/test/e2e/undoSave.cjs).
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const editsOf = (page: Page) =>
  page.evaluate(() => window.devHost!.edits.map((e) => ({ v: e.docVersion, ...e.change })));
const historyOf = (page: Page) => page.evaluate(() => [...window.devHost!.history]);
const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);
const shownText = (page: Page) =>
  page.evaluate(() => {
    const content = window.devApp!.content();
    return content && 'text' in content ? content.text : JSON.stringify(content);
  });

/**
 * Opens the page in tree mode and edits a value there, as a user does, so the edit is in the
 * library's own history too: had the library kept its undo, the undo key would undo it there and
 * send that as an edit of its own. Focus stays in the tree.
 */
async function openEdited(page: Page) {
  await page.goto('/');
  const tree = page.locator('.jse-tree-mode');
  await expect(tree).toContainText('COBOL');
  const original = await hostText(page);
  await tree.getByText('COBOL', { exact: true }).dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Fortran');
  await page.keyboard.press('Enter');
  await expect.poll(() => hostText(page)).toContain('Fortran');
  await expect.poll(() => editsOf(page)).toHaveLength(1);
  const edited = await hostText(page);
  await expect.poll(() => shownText(page)).toBe(edited);
  return { original, edited };
}

test('Ctrl+Z and Ctrl+Y in tree mode undo and redo in the host, and the library does not', async ({
  page,
}) => {
  const { original, edited } = await openEdited(page);
  const edits = (await editsOf(page)).length;
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => hostText(page)).toBe(original);
  await expect.poll(() => shownText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+y');
  await expect.poll(() => hostText(page)).toBe(edited);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => hostText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => hostText(page)).toBe(edited);
  await expect.poll(() => shownText(page)).toBe(edited);
  expect(await historyOf(page)).toEqual(['undo', 'redo', 'undo', 'redo']);
  // The library's own undo would show up as an edit of its own: none came.
  expect(await editsOf(page)).toHaveLength(edits);
});

test("the library's undo and redo buttons go to the host", async ({ page }) => {
  const { original, edited } = await openEdited(page);
  const undo = page.getByRole('button', { name: 'Undo (Ctrl+Z)' });
  const redo = page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => hostText(page)).toBe(original);
  // Enabled although the library's own history has nothing to redo: the host's has.
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect.poll(() => hostText(page)).toBe(edited);
  expect(await historyOf(page)).toEqual(['undo', 'redo']);
});

test('Ctrl+Z in text mode first hands over the typing, then undoes exactly that', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?mode=text');
  const editor = page.locator('.jse-text-mode .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const before = await hostText(page);
  await page.keyboard.type(' ');
  // Well inside the debounce interval: only the undo key makes the library report the typing.
  await page.keyboard.press('ControlOrMeta+z');
  await page.clock.runFor(1);
  await expect.poll(() => historyOf(page)).toEqual(['undo']);
  expect(await editsOf(page)).toEqual([{ v: 1, kind: 'text', text: `${before} ` }]);
  await expect.poll(() => hostText(page)).toBe(before);
  await expect.poll(() => shownText(page)).toBe(before);
  // Focus came back to the editor, so typing goes on where it was.
  await expect(editor).toBeFocused();
});

test("a save's flush hands over the typing text mode holds back", async ({ page }) => {
  await page.clock.install();
  await page.goto('/?mode=text');
  const editor = page.locator('.jse-text-mode .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const before = await hostText(page);
  await page.keyboard.type('  ');
  const flushed = page.evaluate(() => window.devHost!.flush());
  await page.clock.runFor(1);
  await flushed;
  expect(await hostText(page)).toBe(`${before}  `);
  await expect(editor).toBeFocused();
});

test('a flush with nothing held back is answered at once', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
  const before = await hostText(page);
  await page.evaluate(() => window.devHost!.flush());
  expect(await hostText(page)).toBe(before);
  expect(await editsOf(page)).toEqual([]);
});
