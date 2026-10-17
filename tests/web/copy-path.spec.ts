// Spec 018 criteria 5 and 6 (018 T2) on the standalone page. Criterion 5: in tree and table mode,
// the context menu's "Copy JSONPath" and "Copy JSON Pointer" (S2) on a value, a key, an array
// element and a table cell send the host one copy request holding the node's P1 or P2 text, and a
// selection of two rows sends none and shows S1's message; the navigation bar's edit box (S3) shows
// the selected node's JSONPath, its copy button sends that text to the host, and it selects the
// node a JSONPath or JSON Pointer names and shows P3's refusal for one it cannot read. Criterion 6:
// a mode switch keeps the place (S4), in a locked large-file tab between tree and table too. The
// page's host records copy requests (`copies`) and answers for the extension host's `getNode`
// (`requestNode`), which reads the node the page has selected. JSON Lines past a bad line copies and
// reads the text's item index (018 T4, UNK-090).
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DOC = JSON.stringify(
  {
    people: [
      { name: 'Ada', 'a.b': 1 },
      { name: 'Grace', 'a.b': 2 },
    ],
    count: 2,
  },
  null,
  2,
);
/** A root array, which table mode shows (the standalone page's sample, spec 003). */
const ROWS = JSON.stringify(
  [
    { name: 'Ada', language: 'Analytical Engine', year: 1843 },
    { name: 'Grace', language: 'COBOL', year: 1959 },
    { name: 'Barbara', language: 'CLU', year: 1974 },
  ],
  null,
  2,
);
const SIX_MIB = 6 * 2 ** 20;

const copies = (page: Page) => page.evaluate(() => [...window.devHost!.copies]);
const currentNode = (page: Page) => page.evaluate(() => window.devHost!.requestNode());
const node = (page: Page, pointer: string) =>
  page.locator(`.jse-json-node[data-path="${encodeURIComponent(pointer)}"]`).first();
const cell = (page: Page, pointer: string) =>
  page.locator(`.jse-table-mode td[data-path="${encodeURIComponent(pointer)}"]`);
/** A table cell's selected value (the library marks the cell's `.jse-value-outer`). */
const selectedCell = (page: Page, pointer: string) =>
  cell(page, pointer).locator('.jse-value-outer.jse-selected-value');
const menu = (page: Page) => page.locator('div.jse-contextmenu');
const notice = (page: Page) => page.getByRole('status');
const switchTo = (page: Page, mode: 'Tree' | 'Text' | 'Table') =>
  page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: mode }).click();

async function open(page: Page, text: string, query = ''): Promise<void> {
  await page.goto(`/?text=${encodeURIComponent(text)}${query}`);
  await expect(page.locator('.jse-tree-mode, .jse-text-mode, .jse-table-mode')).toBeVisible();
}

/** Opens the context menu on `target` and chooses `item`. */
async function choose(target: ReturnType<Page['locator']>, item: string): Promise<void> {
  await target.click({ button: 'right' });
  await target.page().getByRole('button', { name: item, exact: true }).click();
  await expect(menu(target.page())).toHaveCount(0);
}

/** Text mode's main cursor (CodeMirror's view, as the page reaches it to scroll, App.svelte). */
const cursor = (page: Page) =>
  page.evaluate(() => {
    const content = document.querySelector('.cm-content') as Element & {
      cmTile: { root: { view: { state: { selection: { main: { head: number } } } } } };
    };
    return content.cmTile.root.view.state.selection.main.head;
  });

test.describe('copy path in the context menu (criterion 5)', () => {
  test('tree mode: a value, a key and an array element', async ({ page }) => {
    await open(page, DOC);
    const ada = node(page, '/people/0/name');
    await choose(ada.locator('.jse-value').first(), 'Copy JSONPath');
    expect(await copies(page)).toEqual(['$.people[0].name']);
    await choose(ada.locator('.jse-value').first(), 'Copy JSON Pointer');
    await choose(node(page, '/people/1/a.b').locator('.jse-key').first(), 'Copy JSONPath');
    await choose(node(page, '/people/1/a.b').locator('.jse-key').first(), 'Copy JSON Pointer');
    const item = node(page, '/people/1').locator('.jse-header .jse-bracket').first();
    await choose(item, 'Copy JSONPath');
    await choose(item, 'Copy JSON Pointer');
    expect(await copies(page)).toEqual([
      '$.people[0].name',
      '/people/0/name',
      "$.people[1]['a.b']",
      '/people/1/a.b',
      '$.people[1]',
      '/people/1',
    ]);
  });

  test('table mode: a cell', async ({ page }) => {
    await open(page, ROWS, '&mode=table');
    await expect(page.locator('.jse-table-mode')).toContainText('COBOL');
    await choose(cell(page, '/1/language'), 'Copy JSONPath');
    await choose(cell(page, '/1/language'), 'Copy JSON Pointer');
    expect(await copies(page)).toEqual(['$[1].language', '/1/language']);
  });

  test('the items follow Copy and "Reveal in Text Editor" names the node', async ({ page }) => {
    await open(page, DOC);
    await node(page, '/count').locator('.jse-value').first().click({ button: 'right' });
    const items = menu(page).getByRole('button');
    const texts = (await items.allInnerTexts()).map((t) => t.trim());
    const at = texts.indexOf('Copy JSONPath');
    expect(texts.slice(at, at + 3)).toEqual([
      'Copy JSONPath',
      'Copy JSON Pointer',
      'Reveal in Text Editor',
    ]);
    expect(texts.indexOf('Copy')).toBeLessThan(at);
    await page.getByRole('button', { name: 'Reveal in Text Editor' }).click();
    expect(await page.evaluate(() => window.devHost!.textReveals)).toEqual([['count']]);
    expect(await copies(page)).toEqual([]);
  });

  test('two rows selected: nothing is copied and S1 says why', async ({ page }) => {
    await open(page, DOC);
    await node(page, '/people/0').locator('.jse-header .jse-bracket').first().click();
    const second = node(page, '/people/1').locator('.jse-header .jse-bracket').first();
    await second.click({ modifiers: ['Shift'] });
    await choose(second, 'Copy JSONPath');
    expect(await copies(page)).toEqual([]);
    await expect(notice(page)).toHaveText('Select one node to copy its path.');
    expect(await currentNode(page)).toEqual({ kind: 'several' });
  });

  test('a locked large-file tab offers the items too', async ({ page }) => {
    await open(page, ROWS, `&largeFile=${SIX_MIB}`);
    await choose(node(page, '/2/year').locator('.jse-value').first(), 'Copy JSON Pointer');
    expect(await copies(page)).toEqual(['/2/year']);
  });
});

test.describe('the navigation bar (criterion 5)', () => {
  const editBox = (page: Page) => page.locator('input.jse-navigation-bar-text');
  /** Types `text` in the edit box, opening it first, and presses Enter. */
  async function enter(page: Page, text: string): Promise<void> {
    if ((await editBox(page).count()) === 0) await openEditBox(page);
    await editBox(page).fill(text);
    await editBox(page).press('Enter');
  }
  const openEditBox = (page: Page) => page.locator('button.jse-navigation-bar-edit').click();

  test('shows and copies the JSONPath, and selects what a path names', async ({ page }) => {
    await open(page, DOC);
    await node(page, '/people/1/a.b').locator('.jse-value').first().click();
    await openEditBox(page);
    await expect(editBox(page)).toHaveValue("$.people[1]['a.b']");
    await page.getByTitle('Copy selected path to the clipboard').click();
    expect(await copies(page)).toEqual(["$.people[1]['a.b']"]);

    for (const path of ['$.people[0].name', '/people/0/name']) {
      await enter(page, path);
      await expect(editBox(page)).toHaveCount(0);
      expect(await currentNode(page)).toEqual({ kind: 'path', path: ['people', 0, 'name'] });
      await expect(node(page, '/people/0/name')).toHaveClass(/jse-selected/);
    }

    await enter(page, '$..name');
    await expect(notice(page)).toHaveText(
      'Not a path to one node: `..` selects descendants, not one node.',
    );
    expect(await currentNode(page)).toEqual({ kind: 'path', path: ['people', 0, 'name'] });
    expect(await copies(page)).toEqual(["$.people[1]['a.b']"]);
  });

  test('tells the name "0" from the index 0', async ({ page }) => {
    await open(page, JSON.stringify({ list: ['x'], map: { '0': 'y' } }));
    await node(page, '/map/0').locator('.jse-value').first().click();
    await openEditBox(page);
    await expect(editBox(page)).toHaveValue("$.map['0']");
    await enter(page, '/list/0');
    expect(await currentNode(page)).toEqual({ kind: 'path', path: ['list', 0] });
    await openEditBox(page);
    await expect(editBox(page)).toHaveValue('$.list[0]');
    // `[0]` is an index (P3), and the object holds no index.
    await enter(page, '$.map[0]');
    await expect(notice(page)).toHaveText('Path does not exist in current document');
  });

  test("JSON Lines past a bad line: the text's item index, both ways (UNK-090)", async ({
    page,
  }) => {
    // Items as the text counts them (A5): 0 Ada, 1 the bad line, 2 Grace; the table shows 2 rows.
    const lines = '{"name":"Ada","year":1843}\n{name:"bad"}\n\n{"name":"Grace","year":1906}\n';
    await page.goto(`/?format=jsonl&text=${encodeURIComponent(lines)}`);
    await expect(page.locator('.jse-table-mode')).toContainText('Grace');
    await choose(cell(page, '/1/year'), 'Copy JSONPath');
    await choose(cell(page, '/1/year'), 'Copy JSON Pointer');
    expect(await copies(page)).toEqual(['$[2].year', '/2/year']);
    // The host gets the row the table names and maps it itself (pathCommands.ts).
    expect(await currentNode(page)).toEqual({ kind: 'path', path: [1, 'year'] });

    await switchTo(page, 'Tree');
    await enter(page, '$[2].name');
    await expect(node(page, '/1/name')).toHaveClass(/jse-selected/);
    await openEditBox(page);
    await expect(editBox(page)).toHaveValue('$[2].name');
    await enter(page, '/0/year');
    await expect(node(page, '/0/year')).toHaveClass(/jse-selected/);
  });
});

test.describe('a mode switch keeps the place (criterion 6)', () => {
  test('tree to text, text to tree', async ({ page }) => {
    await open(page, DOC);
    await node(page, '/people/1/a.b').locator('.jse-value').first().click();
    await switchTo(page, 'Text');
    await expect(page.locator('.jse-text-mode')).toBeVisible();
    // The member's place is its key's opening quote (R1).
    await expect.poll(() => cursor(page)).toBe(DOC.indexOf('"a.b": 2'));
    await expect(page.locator('.cm-line', { hasText: '"a.b": 2' })).toBeInViewport();

    await page.locator('.cm-content').getByText('"count"').click();
    await switchTo(page, 'Tree');
    await expect(node(page, '/count')).toHaveClass(/jse-selected/);
    expect(await currentNode(page)).toEqual({ kind: 'path', path: ['count'] });
  });

  test('text to tree scrolls to a node far down and expands its parents', async ({ page }) => {
    const people = Array.from({ length: 150 }, (_, i) => ({ name: `n${i}` }));
    const text = JSON.stringify({ people, count: 150 }).replace(/},/g, '},\n');
    await open(page, text, '&mode=text');
    await expect(page.locator('.jse-text-mode')).toBeVisible();
    await page.evaluate((offset) => {
      const content = document.querySelector('.cm-content') as Element & {
        cmTile: { root: { view: { dispatch(spec: object): void } } };
      };
      content.cmTile.root.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    }, text.indexOf('"n140"'));
    await switchTo(page, 'Tree');
    await expect(node(page, '/people/140/name')).toHaveClass(/jse-selected/);
    await expect(node(page, '/people/140/name')).toBeInViewport();
  });

  test('text to table selects the cell at the cursor', async ({ page }) => {
    await open(page, ROWS, '&mode=text');
    await expect(page.locator('.jse-text-mode')).toBeVisible();
    await page.locator('.cm-content').getByText('"COBOL"').click();
    await switchTo(page, 'Table');
    await expect(selectedCell(page, '/1/language')).toHaveCount(1);
    expect(await currentNode(page)).toEqual({ kind: 'path', path: [1, 'language'] });
  });

  test('table to tree with nothing selected selects nothing, and the next click selects', async ({
    page,
  }) => {
    await open(page, ROWS, '&mode=table');
    await expect(page.locator('.jse-table-mode')).toContainText('COBOL');
    await switchTo(page, 'Tree');
    await expect(page.locator('.jse-tree-mode')).toBeVisible();
    const selected = '.jse-selected, .jse-selected-value, .jse-selected-key';
    await expect(page.locator(`.jse-tree-mode .jse-contents`).locator(selected)).toHaveCount(0);
    expect(await currentNode(page)).toEqual({ kind: 'path', path: [] });
    await node(page, '/1/language').locator('.jse-value').first().click();
    await expect(node(page, '/1/language')).toHaveClass(/jse-selected/);
    expect(await currentNode(page)).toEqual({ kind: 'path', path: [1, 'language'] });
  });

  test('a broken text selects nothing', async ({ page }) => {
    await open(page, '{"a": [1, }', '&mode=text');
    await expect(page.locator('.jse-text-mode')).toBeVisible();
    await page.locator('.cm-content').press('Control+End');
    await switchTo(page, 'Tree');
    await expect(page.locator('.jse-tree-mode')).toBeVisible();
    const selected = '.jse-selected, .jse-selected-value, .jse-selected-key';
    await expect(page.locator(`.jse-tree-mode .jse-contents`).locator(selected)).toHaveCount(0);
  });

  test('a locked large-file tab has no text mode and keeps the selection', async ({ page }) => {
    await open(page, ROWS, `&largeFile=${SIX_MIB}`);
    await expect(page.getByRole('group', { name: 'Mode' }).getByRole('button')).toHaveText([
      'Tree',
      'Table',
    ]);
    await node(page, '/2/language').locator('.jse-value').first().click();
    await switchTo(page, 'Table');
    await expect(selectedCell(page, '/2/language')).toHaveCount(1);
    await switchTo(page, 'Tree');
    await expect(node(page, '/2/language')).toHaveClass(/jse-selected/);
    expect(await currentNode(page)).toEqual({ kind: 'path', path: [2, 'language'] });
  });
});
