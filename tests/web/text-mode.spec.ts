// 003 T6 (spec 003 criterion 9) on the standalone page: typing in text mode reaches the host once
// typing pauses for one debounce interval, as typed, valid or not; invalid text shows the library's
// error marker and the host never gets a repaired text. The e2e suite proves the same in VS Code
// (packages/vscode-extension/test/e2e/textMode.cjs); here the page's clock is fake, so the interval
// is checked to the millisecond. Also the 003 T5 review's carry-forward: a real tree edit made in
// the library reaches the host as a patch (onChange → patchResult.redo → host.save).
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { TEXT_DEBOUNCE_MS } from '../../packages/app-shell/src/text-mode.js';
import { expect, test } from './fixtures';

const editsOf = (page: Page) =>
  page.evaluate(() => window.devHost!.edits.map((e) => ({ v: e.docVersion, ...e.change })));
const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);

/**
 * Opens the page in text mode with the caret at the end of the text and the page's clock stopped:
 * from then on time moves only by `page.clock.runFor`.
 */
async function openText(page: Page, text?: string) {
  await page.clock.install();
  await page.goto(
    text === undefined ? '/?mode=text' : `/?mode=text&text=${encodeURIComponent(text)}`,
  );
  const editor = page.locator('.jse-text-mode .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  return editor;
}

test('typing reaches the host once it pauses for one debounce interval, as one edit', async ({
  page,
}) => {
  await openText(page);
  const before = await hostText(page);
  await page.keyboard.type(' ');
  await page.clock.runFor(TEXT_DEBOUNCE_MS / 2);
  // Still typing: each keystroke starts the interval again.
  await page.keyboard.type('  ');
  await page.clock.runFor(TEXT_DEBOUNCE_MS - 1);
  expect(await editsOf(page)).toEqual([]);
  await page.clock.runFor(1);
  await expect.poll(() => editsOf(page)).toEqual([{ v: 1, kind: 'text', text: `${before}   ` }]);
  expect(await hostText(page)).toBe(`${before}   `);
  await expect(page.locator('.jse-message.jse-error')).toHaveCount(0);
});

test('leaving the editor sends the typing at once', async ({ page }) => {
  await openText(page);
  await page.keyboard.type(' ');
  await page.getByRole('toolbar', { name: 'Editor' }).getByRole('button', { name: 'Text' }).focus();
  // The library notices the focus left on its next timer tick, well before the interval ends.
  await page.clock.runFor(1);
  await expect.poll(() => editsOf(page)).toHaveLength(1);
});

test('invalid text reaches the host as typed and shows an error marker, never a repaired text', async ({
  page,
}) => {
  const valid = '{ "a": 1 }';
  await openText(page, valid);
  await page.keyboard.type(', "b": ');
  await page.clock.runFor(TEXT_DEBOUNCE_MS);
  const typed = `${valid}, "b": `;
  await expect.poll(() => hostText(page)).toBe(typed);
  await expect(page.locator('.jse-text-mode .jse-message.jse-error')).toBeVisible();
  // The gutter marker is drawn with CSS, since the webview CSP blocks CodeMirror's data: images
  // (the fixture fails any test that breaks the CSP).
  const marker = page.locator('.jse-text-mode .cm-lint-marker-error');
  await expect(marker).toHaveCount(1);
  const drawn = await marker.evaluate((e) => {
    const style = getComputedStyle(e);
    return { width: e.getBoundingClientRect().width, background: style.backgroundColor };
  });
  expect(drawn.width).toBeGreaterThan(0);
  expect(drawn.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(await editsOf(page)).toEqual([{ v: 1, kind: 'text', text: typed }]);

  // The tree shows the library's repaired view of the text, but nothing goes to the host. Mode
  // switches need the library's timers, so the clock runs again from here.
  await page.clock.resume();
  const toolbar = page.getByRole('toolbar', { name: 'Editor' });
  await toolbar.getByRole('button', { name: 'Tree' }).click();
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
  await toolbar.getByRole('button', { name: 'Text' }).click();
  await expect(page.locator('.jse-text-mode .jse-message.jse-error')).toBeVisible();
  await page.waitForTimeout(3 * TEXT_DEBOUNCE_MS);
  expect(await editsOf(page)).toHaveLength(1);
  expect(await hostText(page)).toBe(typed);

  // Making it valid again clears the marker.
  await page.locator('.jse-text-mode .cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < ', "b": '.length; i++) await page.keyboard.press('Backspace');
  await expect.poll(() => hostText(page)).toBe(valid);
  await expect(page.locator('.jse-text-mode .jse-message.jse-error')).toHaveCount(0);
});

test('typing after a text was sent stays when the host answers late', async ({ page }) => {
  await openText(page);
  const before = await hostText(page);
  await page.evaluate(() => window.devHost!.hold());
  await page.keyboard.type('a');
  await page.clock.runFor(TEXT_DEBOUNCE_MS);
  await expect.poll(() => editsOf(page)).toHaveLength(1);
  await page.keyboard.type('b');
  await page.evaluate(() => window.devHost!.release());
  await expect.poll(() => hostText(page)).toBe(`${before}a`);
  await page.clock.runFor(TEXT_DEBOUNCE_MS);
  await expect.poll(() => hostText(page)).toBe(`${before}ab`);
  expect(await editsOf(page)).toEqual([
    { v: 1, kind: 'text', text: `${before}a` },
    { v: 2, kind: 'text', text: `${before}ab` },
  ]);
  await expect(page.locator('.jse-text-mode .cm-content')).toContainText('1974 }]ab');
});

test('a value edited in the tree reaches the host as the library patch', async ({ page }) => {
  await page.goto('/');
  const tree = page.locator('.jse-tree-mode');
  await expect(tree).toContainText('COBOL');
  await tree.getByText('COBOL', { exact: true }).dblclick();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Fortran');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => editsOf(page))
    .toEqual([
      {
        v: 1,
        kind: 'patch',
        patch: [{ op: 'replace', path: '/1/language', value: 'Fortran' }],
      },
    ]);
  const data = JSON.parse(await hostText(page)) as { language: string }[];
  expect(data[1].language).toBe('Fortran');
  await expect(tree).toContainText('Fortran');
});
