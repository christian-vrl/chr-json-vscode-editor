// Spec 014 criteria 5, 6 and 9 (014 T3) on the standalone page: JSONPath (RFC 9535) in the library's
// Transform dialog. The page is served under the CHR JSON editor webview's CSP (fixtures.ts), every
// request to another origin is blocked and fails the test, and any CSP violation fails it too, so
// the engine running with no CSP change and no network (criterion 9) shows in every test here. The
// language order with JavaScript and Lodash is in query.spec.ts (011 criterion 8, as amended).
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test';
import JSON5 from 'json5';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

const QUERY_DIR = path.join(__dirname, '..', 'query');
const RFC9535 = 'JSONPath (RFC 9535)';

async function open(page: Page, data: unknown): Promise<string> {
  const text = JSON.stringify(data, null, 2);
  await page.goto(`/?mode=tree&text=${encodeURIComponent(text)}`);
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
  return text;
}

const modal = (page: Page) => page.locator('dialog.jse-transform-modal');
const queryBox = (page: Page) => modal(page).locator('textarea.jse-query');
const transformButton = (page: Page) =>
  modal(page).getByRole('button', { name: 'Transform', exact: true });
const previewData = (page: Page) => modal(page).locator('.jse-preview-data');
const previewError = (page: Page) => modal(page).locator('.jse-preview.jse-error');

/** Opens the Transform dialog from the main menu and picks JSONPath (RFC 9535). */
async function openRfc9535(page: Page): Promise<void> {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('.jse-config').click();
  await page.locator('.jse-query-language', { hasText: RFC9535 }).click();
  await expect(modal(page).locator('.jse-description')).toContainText(RFC9535);
}

/** Picks `label` in one of the wizard's svelte-select fields: type to filter, Enter to pick. */
async function choose(select: Locator, label: string): Promise<void> {
  await select.locator('input[type="text"]').click();
  await select.locator('input[type="text"]').fill(label);
  await select
    .page()
    .locator('.svelte-select-list .item')
    .filter({ hasText: new RegExp(`^${label.replace(/[^\w ]/g, '\\$&')}$`) })
    .click();
}

async function hostUnchanged(page: Page, text: string): Promise<void> {
  expect(await page.evaluate(() => window.devHost!.edits.length)).toBe(0);
  expect(await page.evaluate(() => window.devHost!.text)).toBe(text);
}

/** A corpus case (tests/query/README.md): its input, and its query text, expected data or message
 *  when the case has them. */
function corpusCase(name: string) {
  const dir = path.join(QUERY_DIR, `jsonpath-rfc9535-${name}`);
  const read = (file: string) =>
    existsSync(path.join(dir, file)) ? readFileSync(path.join(dir, file), 'utf8') : undefined;
  const expected = read('expected.json5');
  const error = read('error.json');
  return {
    input: JSON5.parse<unknown>(read('input.json5')!),
    query: read('query.jsonpath')?.replace(/\n$/, ''),
    expected: expected === undefined ? undefined : JSON5.parse<unknown>(expected),
    message: error === undefined ? undefined : (JSON.parse(error) as { message: string }).message,
  };
}

test.describe('criterion 5: dialog and wizard', () => {
  test('the dialog lists JSONPath (RFC 9535) right before JSONPath (Goessner); JSONQuery stays the default', async ({
    page,
  }) => {
    await open(page, [{ n: 1 }]);
    await page.locator('.jse-tree-mode .jse-transform').click();
    await modal(page).locator('.jse-config').click();
    const names = await page.locator('.jse-query-language').allInnerTexts();
    expect(names.slice(0, 4).map((name) => name.trim())).toEqual([
      'JSONQuery',
      'JMESPath',
      RFC9535,
      'JSONPath (Goessner)',
    ]);
    await expect(page.locator('.jse-query-language.selected')).toHaveText('JSONQuery');
  });

  test('its description names RFC 9535 and links to the RFC', async ({ page }) => {
    await open(page, [{ n: 1 }]);
    await openRfc9535(page);
    const description = modal(page).locator('.jse-description');
    await expect(description).toContainText('RFC 9535');
    await expect(description.locator('a')).toHaveAttribute(
      'href',
      'https://www.rfc-editor.org/rfc/rfc9535',
    );
  });

  // Each wizard case's query text is the library's createQuery text (tests/query, 014 T1).
  const wizard: { name: string; fill: (page: Page) => Promise<void>; items: string }[] = [
    {
      name: 'wizard-filter-number',
      fill: async (page) => {
        await choose(modal(page).locator('.jse-filter-path'), 'age');
        await choose(modal(page).locator('.jse-filter-relation'), '>');
        await modal(page).locator('input.jse-filter-value').fill('30');
      },
      items: '2 items',
    },
    {
      name: 'wizard-pick-one',
      fill: (page) => choose(modal(page).locator('.jse-projection-paths'), 'name'),
      items: '4 items',
    },
  ];

  for (const c of wizard) {
    test(`${c.name}: the wizard writes P7's text, the preview shows its result, Transform writes it`, async ({
      page,
    }) => {
      const { input, query, expected } = corpusCase(c.name);
      await open(page, input);
      await openRfc9535(page);
      await c.fill(page);
      await expect(queryBox(page)).toHaveValue(query!);
      await expect(previewData(page)).toContainText(c.items);
      await transformButton(page).click();
      await expect
        .poll(async () => JSON.parse(await page.evaluate(() => window.devHost!.text)) as unknown)
        .toEqual(expected);
    });
  }

  // The library's wizard behavior, the same for JSONPath (Goessner) (spec 014 criterion 5 as amended
  // in 014 T3): the message shows under the wizard, the query box keeps its last valid query and
  // the preview its result, and Transform runs that query.
  const refused: { name: string; fill: (page: Page) => Promise<void>; kept: string }[] = [
    {
      name: 'wizard-sort-refused',
      fill: (page) => choose(modal(page).locator('.jse-sort-path'), 'age'),
      kept: '$',
    },
    {
      name: 'wizard-pick-several-refused',
      fill: async (page) => {
        await choose(modal(page).locator('.jse-projection-paths'), 'name');
        await choose(modal(page).locator('.jse-projection-paths'), 'age');
      },
      kept: '$[*].name',
    },
  ];

  for (const c of refused) {
    test(`${c.name}: the wizard shows the library's JSONPath message and keeps the last query`, async ({
      page,
    }) => {
      const { input, message } = corpusCase(c.name);
      const text = await open(page, input);
      await openRfc9535(page);
      await c.fill(page);
      await expect(modal(page).locator('.query-error')).toHaveText(`Error: ${message!}`);
      await expect(queryBox(page)).toHaveValue(c.kept);
      await expect(previewError(page)).toHaveCount(0);
      await expect(previewData(page)).toContainText(c.kept === '$' ? '1 item' : '4 items');
      await expect(transformButton(page)).toBeEnabled();
      await hostUnchanged(page, text);
    });
  }
});

test.describe('criterion 6: errors', () => {
  // The preview shows the engine's message (error.json) with the engine's position text,
  // `('<query around the error>':<index>)`, which error.json leaves out for the last two.
  for (const name of ['syntax-error', 'type-error', 'unknown-function']) {
    test(`${name} shows its message with its position, Transform is disabled, and the document is unchanged`, async ({
      page,
    }) => {
      const { input, query, message } = corpusCase(name);
      const text = await open(page, input);
      await openRfc9535(page);
      await queryBox(page).fill(query!);
      await expect(previewError(page)).toContainText(message!);
      await expect(previewError(page)).toHaveText(/ \('.+':\d+\)$/);
      await expect(transformButton(page)).toBeDisabled();
      await hostUnchanged(page, text);
    });
  }
});
