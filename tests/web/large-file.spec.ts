// Gate for 008 T2 on the standalone page (spec 008 criteria 2 and 3, and the banner part of 4): a
// document the host opens in large-file mode shows the banner, offers Tree and Table only, and is
// read-only until "Edit anyway": no change, undo or redo leaves the UI, and the whole-document
// actions are not offered, while search, expand and collapse, select and copy still work. The page's
// host plays the extension host's choice (`?largeFile=<bytes>`, main.ts); the e2e suite proves the
// same in VS Code once the host chooses it (008 T3). Contrast is in themes.spec.ts (criterion 12).
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const SIX_MIB = 6 * 2 ** 20;
const LOCKED = 'Large file (6.0 MiB): read-only to stay fast.';
const UNLOCKED = 'Large file (6.0 MiB): edits may be slow.';
const ACTION_BUTTONS = '.jse-format, .jse-compact, .jse-sort, .jse-transform';

const banner = (page: Page) => page.getByRole('region', { name: 'Large file' });
const hostState = (page: Page) =>
  page.evaluate(() => ({
    edits: window.devHost!.edits.length,
    history: [...window.devHost!.history],
    banner: [...window.devHost!.banner],
    docVersion: window.devHost!.docVersion,
    text: window.devHost!.text,
  }));

async function open(page: Page, query: string, mode: 'tree' | 'table' = 'tree') {
  await page.goto(`/?${query}`);
  await expect(page.locator(`.jse-${mode}-mode`)).toContainText('COBOL');
}

test('the banner says the file is read-only, with its size and both buttons', async ({ page }) => {
  await open(page, `largeFile=${SIX_MIB}`);
  await expect(banner(page)).toContainText(LOCKED);
  await expect(banner(page).getByRole('button')).toHaveText(['Open as Text', 'Edit anyway']);
});

for (const [bytes, label] of [
  [5_242_881, '5.0'],
  [10 * 2 ** 20 - 1, '9.9'],
  [52_428_800, '50.0'],
] as const) {
  test(`the banner rounds ${bytes} bytes down to ${label} MiB`, async ({ page }) => {
    await open(page, `largeFile=${bytes}`);
    await expect(banner(page)).toContainText(`Large file (${label} MiB): read-only to stay fast.`);
  });
}

test('the normal editor has no banner and all three modes', async ({ page }) => {
  await open(page, '');
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  const modes = page.getByRole('group', { name: 'Mode' }).getByRole('button');
  await expect(modes).toHaveText(['Tree', 'Text', 'Table']);
});

test('only Tree and Table are offered, and the library menu has no mode switch', async ({
  page,
}) => {
  await open(page, `largeFile=${SIX_MIB}&mode=text`);
  // Asked for text mode, the page opens in tree mode: text mode is not offered.
  const modes = page.getByRole('group', { name: 'Mode' }).getByRole('button');
  await expect(modes).toHaveText(['Tree', 'Table']);
  await expect(page.locator('.jse-tree-mode .jse-group-button')).toHaveCount(0);
  await modes.getByText('Table').click();
  await expect(page.locator('.jse-table-mode')).toContainText('COBOL');
  await expect(page.locator('.jse-table-mode .jse-group-button')).toHaveCount(0);
  // The host asking for text mode changes nothing either.
  await page.evaluate(() => window.devHost!.setMode('text'));
  await page.waitForTimeout(100);
  await expect(page.locator('.jse-table-mode')).toBeVisible();
  await expect(page.locator('.jse-text-mode')).toHaveCount(0);
});

for (const mode of ['tree', 'table'] as const) {
  test(`${mode} mode is read-only: a patch sends no edit and the document stays`, async ({
    page,
  }) => {
    await open(page, `largeFile=${SIX_MIB}&mode=${mode}`, mode);
    const before = await hostState(page);
    const content = await page.evaluate(() => window.devApp!.content());
    await page.evaluate(() =>
      window.devApp!.patch([{ op: 'replace', path: '/1/language', value: 'Fortran' }]),
    );
    await page.waitForTimeout(500);
    expect(await hostState(page)).toEqual(before);
    expect(await page.evaluate(() => window.devApp!.content())).toEqual(content);
    await expect(page.locator(`.jse-${mode}-mode`)).toContainText('COBOL');
    await expect(page.locator(`.jse-${mode}-mode`)).not.toContainText('Fortran');
    expect(await page.evaluate(() => window.devApp!.settled())).toBe(true);
  });

  test(`${mode} mode offers no whole-document action and no edit by keyboard`, async ({ page }) => {
    await open(page, `largeFile=${SIX_MIB}&mode=${mode}`, mode);
    // The menu is rendered; locked table mode leaves it empty (no mode switch, no action).
    await expect(page.locator(`.jse-${mode}-mode .jse-menu`)).toHaveCount(1);
    await expect(page.locator(ACTION_BUTTONS)).toHaveCount(0);
    const before = await hostState(page);
    await page.locator(`.jse-${mode}-mode`).getByText('COBOL').click();
    for (const key of ['Delete', 'Enter', 'x', 'ControlOrMeta+v', 'ControlOrMeta+d']) {
      await page.keyboard.press(key);
    }
    // Undo and redo do not reach the host's history: they would change the document.
    for (const key of ['ControlOrMeta+z', 'ControlOrMeta+y', 'ControlOrMeta+Shift+z']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(500);
    expect(await hostState(page)).toEqual(before);
    await expect(page.locator(`.jse-${mode}-mode`)).toContainText('COBOL');
  });
}

test('search, expand and collapse, select and copy work in a locked file', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, `largeFile=${SIX_MIB}`);
  const tree = page.locator('.jse-tree-mode');

  await tree.locator('.jse-collapse-all').click();
  await expect(tree).not.toContainText('COBOL');
  await tree.locator('.jse-expand-all').click();
  await expect(tree).toContainText('COBOL');

  await tree.locator('.jse-search').click();
  await page.keyboard.type('COBOL');
  await expect(tree.locator('.jse-search-input')).toHaveValue('COBOL');
  await expect(tree.locator('.jse-search-count')).toHaveText('1/1');
  await expect(tree.locator('.jse-highlight.jse-active')).toHaveText('COBOL');
  await page.keyboard.press('Escape');

  await tree.getByText('Grace').click();
  await expect(tree.locator('.jse-selected-value')).toContainText('Grace');
  await expect(tree.locator('.jse-copy')).toBeEnabled();
  await tree.locator('.jse-copy').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Grace');
  expect((await hostState(page)).edits).toBe(0);
});

test('"Open as Text" asks the host for its text editor and changes nothing', async ({ page }) => {
  await open(page, `largeFile=${SIX_MIB}`);
  await banner(page).getByRole('button', { name: 'Open as Text' }).click();
  const state = await hostState(page);
  expect(state.banner).toEqual(['openAsText']);
  expect(state.edits).toBe(0);
  await expect(banner(page)).toContainText(LOCKED);
});

test('"Edit anyway" unlocks the tab: edits reach the host, text mode stays unavailable', async ({
  page,
}) => {
  await open(page, `largeFile=${SIX_MIB}`);
  await banner(page).getByRole('button', { name: 'Edit anyway' }).click();
  await expect(banner(page)).toContainText(UNLOCKED);
  await expect(banner(page).getByRole('button')).toHaveText(['Open as Text']);
  expect((await hostState(page)).banner).toEqual(['unlock']);
  expect(await page.evaluate(() => window.devHost!.largeFile)).toEqual({
    bytes: SIX_MIB,
    unlocked: true,
  });

  // The tab edits like spec 003: whole-document actions are back, a patch reaches the host.
  await expect(page.locator('.jse-tree-mode .jse-transform')).toBeVisible();
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'replace', path: '/1/language', value: 'Fortran' }]),
  );
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toContain('"language": "Fortran"');
  await expect(page.locator('.jse-tree-mode')).toContainText('Fortran');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await hostState(page)).history).toEqual(['undo']);
  await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');

  const modes = page.getByRole('group', { name: 'Mode' }).getByRole('button');
  await expect(modes).toHaveText(['Tree', 'Table']);
  await expect(page.locator('.jse-tree-mode .jse-group-button')).toHaveCount(0);
});

test('a tab the host says is unlocked opens unlocked (a reloaded webview)', async ({ page }) => {
  await open(page, `largeFile=${SIX_MIB}&unlocked=1`);
  await expect(banner(page)).toContainText(UNLOCKED);
  await expect(banner(page).getByRole('button')).toHaveText(['Open as Text']);
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'replace', path: '/0/year', value: 1842 }]),
  );
  await expect.poll(() => page.evaluate(() => window.devHost!.text)).toContain('1842');
});
