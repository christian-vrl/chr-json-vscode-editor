// Gate for 012 T4 on the standalone page (spec 012 criterion 8's banner and read-only parts, and
// the webview's share of criterion 6): a JSON Lines document opens in Table mode with Table and Tree
// only, no format or compact, and its items as the table's rows, even for a one-line file (plan 012
// risk R2). A document with a bad line shows its items read-only under a banner naming the first bad
// line, with "Open as Text" and "Repair Lines"; when no bad line is left, from a repair or an edit
// made elsewhere, the banner goes and the tab edits again. The page's host plays the extension
// host's part (`?format=jsonl`, main.ts); VS Code's side is 012 T5's e2e. Contrast is in
// themes.spec.ts (criterion 13).
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const LINES = '{"name":"Ada","year":1843}\n{"name":"Grace","year":1959}\n';
/** Lines 2 and 4 are bad; line 3 is blank, which is never bad. */
const BAD = '{"name":"Ada","year":1843}\n{"name":"Grace",\n\n{name:"Barbara"}\n';

const banner = (page: Page) => page.getByRole('region', { name: 'Bad lines' });
const modeButtons = (page: Page) => page.getByRole('group', { name: 'Mode' }).getByRole('button');
const hostState = (page: Page) =>
  page.evaluate(() => ({
    edits: window.devHost!.edits.length,
    banner: [...window.devHost!.banner],
    docVersion: window.devHost!.docVersion,
    text: window.devHost!.text,
  }));

async function open(page: Page, text: string, query = '') {
  await page.goto(`/?format=jsonl&text=${encodeURIComponent(text)}${query}`);
  await expect(page.locator('.jse-table-mode, .jse-tree-mode')).toBeVisible();
}

test('a JSON Lines document opens in Table mode, with Table and Tree only', async ({ page }) => {
  await open(page, LINES);
  await expect(page.locator('.jse-table-mode')).toContainText('Grace');
  await expect(modeButtons(page)).toHaveText(['Table', 'Tree']);
  await expect(page.locator('.jse-table-mode .jse-group-button')).toHaveText(['table', 'tree']);
  await expect(page.locator('.format')).toHaveText('JSON Lines');
  await expect(banner(page)).toHaveCount(0);
  await modeButtons(page).getByText('Tree').click();
  await expect(page.locator('.jse-tree-mode')).toContainText('Grace');
  await expect(page.locator('.jse-tree-mode .jse-group-button')).toHaveText(['table', 'tree']);
  // The host asking for text mode changes nothing.
  await page.evaluate(() => window.devHost!.setMode('text'));
  await page.waitForTimeout(100);
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
  await expect(page.locator('.jse-text-mode')).toHaveCount(0);
});

test('a host asking for text mode opens Table mode', async ({ page }) => {
  await open(page, LINES, '&mode=text');
  await expect(page.locator('.jse-table-mode')).toContainText('Grace');
});

for (const mode of ['table', 'tree'] as const) {
  test(`${mode} mode offers sort and transform but not format or compact`, async ({ page }) => {
    await open(page, LINES, `&mode=${mode}`);
    const menu = page.locator(`.jse-${mode}-mode .jse-menu`).first();
    await expect(menu.locator('.jse-sort')).toBeVisible();
    await expect(menu.locator('.jse-transform')).toBeVisible();
    await expect(menu.locator('.jse-search')).toBeVisible();
    await expect(page.locator('.jse-format, .jse-compact')).toHaveCount(0);
  });
}

test('a one-line file is a table of one item, not the item itself', async ({ page }) => {
  await open(page, '{"name":"Ada","year":1843}', '&mode=tree');
  await expect(page.locator('.jse-tree-mode')).toContainText('1 item');
  await expect(page.locator('.jse-tree-mode')).toContainText('Ada');
});

test('an empty file opens as an empty table (L1)', async ({ page }) => {
  await open(page, '', '&mode=tree');
  await expect(page.locator('.jse-tree-mode')).toContainText('0 items');
  await expect(banner(page)).toHaveCount(0);
});

test('an edit writes one line; the other lines keep their bytes', async ({ page }) => {
  const text = '{"name":"Ada", "year":1843}\r\n\r\n{"name":"Grace","year":1959}\r\n';
  await open(page, text);
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'replace', path: '/1/year', value: 1960 }]),
  );
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toBe('{"name":"Ada", "year":1843}\r\n\r\n{"name":"Grace","year":1960}\r\n');
  await expect(page.locator('.jse-table-mode')).toContainText('1960');
});

test('the banner names the first bad line and how many there are', async ({ page }) => {
  await open(page, BAD);
  await expect(banner(page)).toHaveText(
    /^\s*Line 2 is not valid JSON \(2 bad lines\)\.\s*Open as Text\s*Repair Lines\s*$/,
  );
  await expect(banner(page).getByRole('button')).toHaveText(['Open as Text', 'Repair Lines']);
  // The items of the other lines show.
  await expect(page.locator('.jse-table-mode')).toContainText('Ada');
  await modeButtons(page).getByText('Tree').click();
  await expect(page.locator('.jse-tree-mode')).toContainText('1 item');
});

test('one bad line reads "1 bad line"', async ({ page }) => {
  await open(page, '{"a":1}\n\n{"b":\n');
  await expect(banner(page)).toContainText('Line 3 is not valid JSON (1 bad line).');
});

test('blank lines of spaces and tabs are never bad', async ({ page }) => {
  await open(page, ' \t\n{"a":1}\n\t\n   \n');
  await expect(page.locator('.jse-table-mode')).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

for (const mode of ['table', 'tree'] as const) {
  test(`${mode} mode with a bad line is read-only: no edit leaves the UI`, async ({ page }) => {
    await open(page, BAD, `&mode=${mode}`);
    await expect(page.locator(`.jse-${mode}-mode`)).toContainText('Ada');
    const before = await hostState(page);
    const content = await page.evaluate(() => window.devApp!.content());
    await page.evaluate(() =>
      window.devApp!.patch([{ op: 'replace', path: '/0/name', value: 'Lovelace' }]),
    );
    await page.locator(`.jse-${mode}-mode`).getByText('Ada').click();
    for (const key of ['Delete', 'Enter', 'x', 'ControlOrMeta+v', 'ControlOrMeta+d']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(500);
    expect(await hostState(page)).toEqual(before);
    expect(await page.evaluate(() => window.devApp!.content())).toEqual(content);
    await expect(page.locator(`.jse-${mode}-mode`)).not.toContainText('Lovelace');
    await expect(page.locator('.jse-sort, .jse-transform')).toHaveCount(0);
  });
}

test('"Open as Text" asks the host for its text editor and changes nothing', async ({ page }) => {
  await open(page, BAD);
  await banner(page).getByRole('button', { name: 'Open as Text' }).click();
  const state = await hostState(page);
  expect(state.banner).toEqual(['openAsText']);
  expect(state.edits).toBe(0);
  expect(state.text).toBe(BAD);
});

test('"Repair Lines" is one action; with no bad line left the tab edits again', async ({
  page,
}) => {
  await open(page, BAD);
  await banner(page).getByRole('button', { name: 'Repair Lines' }).click();
  await expect
    .poll(() => page.evaluate(() => window.devHost!.edits))
    .toEqual([{ docVersion: 1, change: { kind: 'action', action: { name: 'repairLines' } } }]);
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toBe('{"name":"Ada","year":1843}\n{"name":"Grace"}\n\n{"name":"Barbara"}\n');
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator('.notice')).toHaveText('');
  await expect(page.locator('.jse-table-mode')).toContainText('Barbara');
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'replace', path: '/2/name', value: 'Liskov' }]),
  );
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toBe('{"name":"Ada","year":1843}\n{"name":"Grace"}\n\n{"name":"Liskov"}\n');
  // One undo in the host's history restores the text before the repair's edit.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => window.devHost!.text)).toBe(BAD);
  await expect(banner(page)).toContainText('Line 2 is not valid JSON (2 bad lines).');
});

test('"Repair Lines" names the lines it could not repair, which stay bad', async ({ page }) => {
  const text = '{"a":1} {"b":2}\n{"c":\n{"d":4}\n';
  await open(page, text);
  await expect(banner(page)).toContainText('Line 1 is not valid JSON (2 bad lines).');
  await banner(page).getByRole('button', { name: 'Repair Lines' }).click();
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toBe('{"a":1} {"b":2}\n{"c":null}\n{"d":4}\n');
  await expect(page.locator('.notice')).toHaveText('Repair Lines could not repair line 1.');
  await expect(banner(page)).toContainText('Line 1 is not valid JSON (1 bad line).');
});

test('an edit made elsewhere that leaves no bad line makes the tab editable', async ({ page }) => {
  await open(page, BAD);
  await page.evaluate(() =>
    window.devHost!.externalChange('{"name":"Ada","year":1843}\n{"name":"Grace"}\n'),
  );
  await expect(banner(page)).toHaveCount(0);
  await expect(page.locator('.jse-table-mode')).toContainText('Grace');
  await expect(page.locator('.jse-table-mode .jse-sort')).toBeVisible();
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'add', path: '/-', value: { name: 'Barbara' } }]),
  );
  await expect
    .poll(() => page.evaluate(() => window.devHost!.text))
    .toBe('{"name":"Ada","year":1843}\n{"name":"Grace"}\n{"name":"Barbara"}\n');
});

test('an edit made elsewhere that adds a bad line makes the tab read-only', async ({ page }) => {
  await open(page, LINES);
  await page.evaluate(() => window.devHost!.externalChange('{"name":"Ada"}\n{oops\n'));
  await expect(banner(page)).toContainText('Line 2 is not valid JSON (1 bad line).');
  const before = await hostState(page);
  await page.evaluate(() =>
    window.devApp!.patch([{ op: 'replace', path: '/0/name', value: 'Lovelace' }]),
  );
  await page.waitForTimeout(300);
  expect(await hostState(page)).toEqual(before);
});

test('choosing JSON Lines in text mode switches to Table; leaving it keeps the bytes', async ({
  page,
}) => {
  await page.goto(`/?mode=text&text=${encodeURIComponent(LINES)}`);
  await expect(page.locator('.jse-text-mode')).toBeVisible();
  // As JSON, two lines are one value too many: a parse error, no banner.
  await expect(banner(page)).toHaveCount(0);
  await page.evaluate(() => window.devHost!.setFormat('jsonl'));
  await expect(page.locator('.jse-table-mode')).toContainText('Grace');
  await expect(modeButtons(page)).toHaveText(['Table', 'Tree']);
  await expect(page.locator('.jse-table-mode .jse-group-button')).toHaveText(['table', 'tree']);
  await expect(page.locator('.jse-format, .jse-compact')).toHaveCount(0);
  await page.evaluate(() => window.devHost!.setFormat('json'));
  await expect(modeButtons(page)).toHaveText(['Tree', 'Text', 'Table']);
  await expect(page.locator('.jse-table-mode .jse-group-button')).toHaveText([
    'text',
    'tree',
    'table',
  ]);
  expect((await hostState(page)).text).toBe(LINES);
  expect((await hostState(page)).edits).toBe(0);
});

// 012 T6 (spec 012 criterion 10): a large JSON Lines document (`largeFile`, as the host chooses it
// above the threshold) shows both banners with a bad line, the items of the other lines, "Edit
// anyway" disabled until no bad line is left, and "Repair Lines" running on the locked tab.
test.describe('a large JSON Lines document', () => {
  const SIX_MIB = 6 * 2 ** 20;
  const large = (page: Page) => page.getByRole('region', { name: 'Large file' });

  test('with a bad line shows both banners and the other items', async ({ page }) => {
    await open(page, BAD, `&largeFile=${SIX_MIB}`);
    await expect(large(page)).toContainText('Large file (6.0 MiB): read-only to stay fast.');
    await expect(banner(page)).toContainText('Line 2 is not valid JSON (2 bad lines).');
    await expect(page.locator('.jse-table-mode')).toContainText('Ada');
    await expect(modeButtons(page)).toHaveText(['Table', 'Tree']);
    await modeButtons(page).getByText('Tree').click();
    await expect(page.locator('.jse-tree-mode')).toContainText('1 item');
  });

  test('"Edit anyway" waits for no bad line; "Repair Lines" runs locked', async ({ page }) => {
    await open(page, BAD, `&largeFile=${SIX_MIB}`);
    const editAnyway = large(page).getByRole('button', { name: 'Edit anyway' });
    await expect(editAnyway).toBeDisabled();
    await editAnyway.click({ force: true });
    await page.waitForTimeout(200);
    expect((await hostState(page)).banner).toEqual([]);
    await banner(page).getByRole('button', { name: 'Repair Lines' }).click();
    await expect
      .poll(() => page.evaluate(() => window.devHost!.text))
      .toBe('{"name":"Ada","year":1843}\n{"name":"Grace"}\n\n{"name":"Barbara"}\n');
    await expect(banner(page)).toHaveCount(0);
    // Still locked: a patch sends nothing, and "Edit anyway" now unlocks.
    await expect(large(page)).toContainText('read-only to stay fast.');
    const edits = (await hostState(page)).edits;
    await page.evaluate(() =>
      window.devApp!.patch([{ op: 'replace', path: '/0/name', value: 'Lovelace' }]),
    );
    await page.waitForTimeout(300);
    expect((await hostState(page)).edits).toBe(edits);
    await expect(editAnyway).toBeEnabled();
    await editAnyway.click();
    await expect(large(page)).toContainText('edits may be slow.');
    await page.evaluate(() =>
      window.devApp!.patch([{ op: 'replace', path: '/0/name', value: 'Lovelace' }]),
    );
    await expect
      .poll(() => page.evaluate(() => window.devHost!.text))
      .toBe('{"name":"Lovelace","year":1843}\n{"name":"Grace"}\n\n{"name":"Barbara"}\n');
  });

  test('with no bad line shows no bad-line banner and unlocks', async ({ page }) => {
    await open(page, LINES, `&largeFile=${SIX_MIB}`);
    await expect(page.locator('.jse-table-mode')).toContainText('Grace');
    await expect(banner(page)).toHaveCount(0);
    await large(page).getByRole('button', { name: 'Edit anyway' }).click();
    await expect(large(page)).toContainText('edits may be slow.');
  });
});
