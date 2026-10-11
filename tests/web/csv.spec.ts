// Gate for 009 T3 (`pnpm test:web`): spec 009 criterion 6 and the theme part of criterion 9. The
// CSV panel page (packages/app-shell/csv.html) runs over a DevCsvHostAdapter holding a fixture from
// tests/csv, under the webview CSP with other origins blocked (fixtures.ts).
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type {
  DevCsvHostAdapter,
  DevCsvInput,
} from '../../packages/app-shell/src/dev-csv-host-adapter.js';
import { expect, test } from './fixtures';
import { applyTheme, expectContrast, loadTheme, THEMES } from './theme-helpers';

// Set by the standalone CSV page (packages/app-shell/src/csv-main.ts).
declare global {
  interface Window {
    chrCsvInput?: DevCsvInput;
    devCsvHost?: DevCsvHostAdapter;
  }
}

const DIR = path.resolve(__dirname, '../csv');
const read = (file: string) => readFileSync(path.join(DIR, file), 'utf8');

function exportOf(file: string): Extract<DevCsvInput, { mode: 'export' }> {
  return { mode: 'export', name: path.basename(file), data: JSON.parse(read(file)) };
}

function importOf(file: string, canReplace = false): DevCsvInput {
  return { mode: 'import', name: path.basename(file), text: read(file), canReplace };
}

async function openCsv(page: Page, input: DevCsvInput): Promise<void> {
  await page.addInitScript((value) => {
    window.chrCsvInput = value;
  }, input);
  await page.goto('/csv.html');
  await expect(page.getByRole('heading')).not.toHaveText('');
}

const option = (page: Page, name: string): Locator => page.getByLabel(name, { exact: true });
const delimiter = (page: Page): Locator => page.getByRole('combobox', { name: 'Delimiter' });
const csvPreview = (page: Page): Locator => page.getByLabel('CSV preview');
const status = (page: Page): Locator => page.getByRole('status');
const button = (page: Page, name: string): Locator => page.getByRole('button', { name });
const table = (page: Page): Locator => page.locator('.table .jse-table-mode');

/** Changes an option and checks the preview follows within 500 ms (criterion 6). */
async function within500ms(
  change: () => Promise<unknown>,
  check: () => Promise<void>,
): Promise<void> {
  const start = Date.now();
  await change();
  await check();
  expect(Date.now() - start, 'the preview followed the option within 500 ms').toBeLessThan(500);
}

const PEOPLE_CSV =
  'name,address.city,address.zip,tags,address\n' +
  'Ada,London,NW1,"[""math"",""poetry""]",\n' +
  'Grace,New York,,"[""navy""]",\n' +
  '"Linus, Jr.",,,[],{}';

test.describe('export', () => {
  test('shows each export option with its default and the CSV of the rows', async ({ page }) => {
    await openCsv(page, exportOf('export/people.json'));
    await expect(page.getByRole('heading')).toHaveText('Export people.json to CSV');
    await expect(delimiter(page)).toHaveValue(',');
    await expect(delimiter(page).locator('option:checked')).toHaveText('Comma (,)');
    await expect(delimiter(page).locator('option')).toHaveText([
      'Comma (,)',
      'Semicolon (;)',
      'Tab',
      'Pipe (|)',
    ]);
    await expect(option(page, 'Header row')).toBeChecked();
    await expect(option(page, 'Flatten nested objects')).toBeChecked();
    await expect(option(page, 'Flatten nested arrays')).not.toBeChecked();
    await expect(option(page, 'UTF-8 BOM (for Excel)')).not.toBeChecked();
    // Import's own option is not offered.
    await expect(option(page, 'Nested objects from field names')).toHaveCount(0);
    await expect(csvPreview(page)).toHaveText(PEOPLE_CSV, { useInnerText: true });
    await expect(status(page)).toHaveText('3 rows, 5 columns');
    await expect(button(page, 'Save CSV…')).toBeEnabled();
    await expect(button(page, 'Copy CSV')).toBeEnabled();
    await expect(button(page, 'Create JSON File')).toHaveCount(0);
    await expect(button(page, 'Replace Document Data')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Warnings' })).toHaveCount(0);
  });

  test('follows each option change within 500 ms', async ({ page }) => {
    await openCsv(page, exportOf('export/people.json'));
    await expect(csvPreview(page)).toHaveText(PEOPLE_CSV, { useInnerText: true });
    await within500ms(
      () => delimiter(page).selectOption(';'),
      () =>
        expect(csvPreview(page)).toContainText('name;address.city;address.zip;tags;address', {
          timeout: 500,
        }),
    );
    await within500ms(
      () => option(page, 'Header row').uncheck(),
      () => expect(csvPreview(page)).not.toContainText('name;', { timeout: 500 }),
    );
    await within500ms(
      () => option(page, 'Flatten nested arrays').check(),
      () => expect(csvPreview(page)).toContainText('Ada;London;NW1;math;poetry', { timeout: 500 }),
    );
    await within500ms(
      () => option(page, 'Flatten nested objects').uncheck(),
      () => expect(csvPreview(page)).toContainText('Ada;"{""city"":""London""', { timeout: 500 }),
    );
    await within500ms(
      () => option(page, 'UTF-8 BOM (for Excel)').check(),
      () => expect(status(page)).toHaveText('3 rows, 5 columns, UTF-8 BOM', { timeout: 500 }),
    );
    await within500ms(
      () => delimiter(page).selectOption('\t'),
      () => expect(csvPreview(page)).toContainText('Ada\t"{', { timeout: 500 }),
    );
  });

  test('previews the first 100 rows of a longer row source', async ({ page }) => {
    await openCsv(page, exportOf('export/many.json'));
    await expect(status(page)).toHaveText('First 100 of 250 rows, 3 columns');
    const text = await csvPreview(page).innerText();
    const lines = text.trimEnd().split(/\r?\n/);
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe('id,label,even');
    expect(lines[100]).toBe('100,row 100,true');
  });

  test('Save CSV… and Copy CSV ask the host for the full export with the options shown', async ({
    page,
  }) => {
    await openCsv(page, exportOf('export/many.json'));
    await button(page, 'Save CSV…').click();
    await delimiter(page).selectOption('|');
    await option(page, 'UTF-8 BOM (for Excel)').check();
    await button(page, 'Copy CSV').click();
    await expect.poll(() => page.evaluate(() => window.devCsvHost!.writes.length)).toBe(2);
    const writes = await page.evaluate(() => window.devCsvHost!.writes);
    expect(writes.map((w) => w.action)).toEqual(['save', 'copy']);
    expect(writes[0]).toMatchObject({
      name: 'many.csv',
      options: {
        delimiter: ',',
        header: true,
        flattenObjects: true,
        flattenArrays: false,
        bom: false,
      },
    });
    expect(writes[1]).toMatchObject({ options: { delimiter: '|', bom: true } });
    const copied = writes[1]!.action === 'copy' ? writes[1]!.text : '';
    expect(copied.startsWith('﻿id|label|even\r\n')).toBe(true);
    expect(copied.trimEnd().split('\r\n')).toHaveLength(251);
  });

  test('an error replaces the preview and disables every button', async ({ page }) => {
    await openCsv(page, exportOf('export/not-rows.json'));
    await expect(page.getByRole('alert')).toHaveText('CSV export needs an array or an object');
    await expect(csvPreview(page)).toHaveCount(0);
    await expect(button(page, 'Save CSV…')).toBeDisabled();
    await expect(button(page, 'Copy CSV')).toBeDisabled();
    await expect(status(page)).toHaveText('');
  });

  test('names the row source when it is not the root', async ({ page }) => {
    await openCsv(page, { ...exportOf('export/people.json'), pointer: '/people' });
    await expect(page.getByRole('heading')).toHaveText('Export /people of people.json to CSV');
  });
});

test.describe('import', () => {
  test('shows each import option with its default and the rows in a read-only table', async ({
    page,
  }) => {
    await openCsv(page, importOf('import/people.csv'));
    await expect(page.getByRole('heading')).toHaveText('Import people.csv');
    await expect(delimiter(page)).toHaveValue('detect');
    await expect(delimiter(page).locator('option')).toHaveText([
      'Detect (Semicolon (;))',
      'Comma (,)',
      'Semicolon (;)',
      'Tab',
      'Pipe (|)',
    ]);
    await expect(option(page, 'Header row')).toBeChecked();
    await expect(option(page, 'Nested objects from field names')).toBeChecked();
    // Export's own options are not offered.
    for (const name of [
      'Flatten nested objects',
      'Flatten nested arrays',
      'UTF-8 BOM (for Excel)',
    ]) {
      await expect(option(page, name)).toHaveCount(0);
    }
    await expect(table(page)).toBeVisible();
    await expect(table(page)).toContainText('London');
    await expect(table(page)).toContainText('New York');
    await expect(status(page)).toHaveText('2 rows');
    // Read-only, a table only: no mode switch, no editing.
    await expect(page.locator('.table .jse-group-button')).toHaveCount(0);
    await table(page).getByText('London').dblclick();
    await expect(
      page
        .locator('.table')
        .locator('[contenteditable="true"], textarea, input:not(.jse-hidden-input)'),
    ).toHaveCount(0);
    await expect(button(page, 'Create JSON File')).toBeEnabled();
    // From a .csv file alone ("Convert CSV to JSON"): there is no document to replace.
    await expect(button(page, 'Replace Document Data')).toHaveCount(0);
    await expect(button(page, 'Save CSV…')).toHaveCount(0);
  });

  test('follows each option change within 500 ms', async ({ page }) => {
    await openCsv(page, importOf('import/people.csv'));
    await expect(table(page)).toContainText('London');
    const column = (name: string) =>
      page.locator('.table').getByRole('columnheader', { name, exact: true });
    await expect(column('address.city')).toBeVisible();
    await within500ms(
      () => option(page, 'Header row').uncheck(),
      () => expect(column('Field 0')).toBeVisible({ timeout: 500 }),
    );
    await expect(status(page)).toHaveText('3 rows');
    await option(page, 'Header row').check();
    await expect(column('address.city')).toBeVisible();
    // Nested off: `tags[0]` is a flat key, which the table names with the key quoted.
    await within500ms(
      () => option(page, 'Nested objects from field names').uncheck(),
      () => expect(column('["tags[0]"]')).toBeVisible({ timeout: 500 }),
    );
    await within500ms(
      () => delimiter(page).selectOption(','),
      () =>
        expect(page.locator('.table').getByRole('columnheader')).toHaveCount(2, { timeout: 500 }),
    );
  });

  test('lists warnings with their lines under the preview', async ({ page }) => {
    await openCsv(page, importOf('import/warnings.csv'));
    const warnings = page.getByRole('list', { name: 'Warnings' }).getByRole('listitem');
    await expect(warnings).toHaveText([
      'Line 1: Field name "name" is repeated; this column is named "name_1"',
      'Line 3: Text after a closing quote is kept as part of the field',
      'Line 3: The record has more fields than there are field names; extra fields are kept as "Field 3"',
    ]);
    await expect(table(page)).toContainText('Gracex');
    await expect(button(page, 'Create JSON File')).toBeEnabled();
  });

  test('an error replaces the preview with its message and line and disables every button', async ({
    page,
  }) => {
    await openCsv(page, importOf('import/open-quote.csv', true));
    await expect(page.getByRole('alert')).toHaveText('Line 3: A quoted field is not closed');
    await expect(page.locator('.table')).toBeHidden();
    await expect(button(page, 'Create JSON File')).toBeDisabled();
    await expect(button(page, 'Replace Document Data')).toBeDisabled();
    await expect(page.getByRole('list', { name: 'Warnings' })).toHaveCount(0);
  });

  test('previews the first 100 rows of a longer file', async ({ page }) => {
    await openCsv(page, importOf('import/many.csv'));
    await expect(status(page)).toHaveText('First 100 rows');
    await option(page, 'Header row').uncheck();
    await expect(status(page)).toHaveText('First 100 rows');
    const sent = await page.evaluate(() => window.devCsvHost!.open());
    expect(sent).toMatchObject({ mode: 'import', complete: false });
  });

  test('Create JSON File and Replace Document Data ask the host with the options shown', async ({
    page,
  }) => {
    await openCsv(page, importOf('import/people.csv', true));
    await button(page, 'Create JSON File').click();
    await option(page, 'Nested objects from field names').uncheck();
    await button(page, 'Replace Document Data').click();
    await expect.poll(() => page.evaluate(() => window.devCsvHost!.writes.length)).toBe(2);
    const writes = await page.evaluate(() => window.devCsvHost!.writes);
    expect(writes[0]).toMatchObject({
      action: 'createFile',
      name: 'people.json',
      options: { delimiter: 'detect', header: true, nestedObjects: true },
    });
    expect(writes[1]).toEqual({
      action: 'replaceData',
      options: { delimiter: 'detect', header: true, nestedObjects: false },
      data: [
        {
          name: 'Ada',
          'address.city': 'London',
          'address.zip': 'NW1',
          'tags[0]': 'math',
          'tags[1]': 'poetry',
        },
        {
          name: 'Grace',
          'address.city': 'New York',
          'address.zip': null,
          'tags[0]': 'navy',
          'tags[1]': null,
        },
      ],
    });
  });

  test('an error the full conversion finds past the preview shows until an option changes', async ({
    page,
  }) => {
    await openCsv(page, importOf('import/late-open-quote.csv'));
    await expect(status(page)).toHaveText('First 100 rows');
    await button(page, 'Create JSON File').click();
    await expect(page.getByRole('alert')).toHaveText('Line 152: A quoted field is not closed');
    await expect(page.locator('.table')).toBeHidden();
    await expect(button(page, 'Create JSON File')).toBeDisabled();
    expect(await page.evaluate(() => window.devCsvHost!.writes)).toEqual([]);
    await option(page, 'Nested objects from field names').uncheck();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(table(page)).toBeVisible();
    await expect(button(page, 'Create JSON File')).toBeEnabled();
  });
});

// Criterion 9, theme part: with each captured VS Code theme, the CSV panel passes axe-core's
// color-contrast rule in each state it can show.
for (const name of THEMES) {
  const theme = loadTheme(name);

  test.describe(`${name} theme (${theme.theme})`, () => {
    test('export preview passes axe color-contrast', async ({ page }) => {
      await applyTheme(page, theme);
      await openCsv(page, exportOf('export/people.json'));
      await expect(csvPreview(page)).toBeVisible();
      await expectContrast(page);
    });

    test('import table with warnings passes axe color-contrast', async ({ page }) => {
      await applyTheme(page, theme);
      await openCsv(page, importOf('import/warnings.csv', true));
      await expect(table(page)).toContainText('Gracex');
      await expect(page.getByRole('list', { name: 'Warnings' })).toBeVisible();
      await expectContrast(page);
    });

    test('an error with disabled buttons passes axe color-contrast', async ({ page }) => {
      await applyTheme(page, theme);
      await openCsv(page, importOf('import/open-quote.csv', true));
      await expect(page.getByRole('alert')).toBeVisible();
      await expectContrast(page);
    });
  });
}
