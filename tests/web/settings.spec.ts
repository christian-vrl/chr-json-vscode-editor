// Spec 019 on the standalone page (019 T2): the page's settings arrive with `init` (`?settings=`,
// as the extension host fills `init.settings`) and in a `settings` message when they change
// (`devHost.setSettings`, as the host sends it to every open tab, A2).
// - Criterion 7 (Q1): a tab's first Transform dialog starts with the setting's language; a language
//   picked in a dialog stays picked in that tab when the setting changes, and a new tab starts with
//   the new value; a language the threshold leaves out starts the dialog with JSONQuery.
// - Criterion 9 (D1, D2): `flattenColumns` off shows a nested object in one table column, and the
//   escape settings show a control character and a non-ASCII character escaped in tree and table
//   mode; text mode's text, the editor's data and the host's document stay as they were (no `edit`),
//   and each change shows within 500 ms.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import type { EditorSettings } from '../../packages/app-shell/src/protocol';
import { expect, test } from './fixtures';

const modal = (page: Page) => page.locator('dialog.jse-transform-modal');

/** The standalone page with `settings` in `init`. */
function open(page: Page, query: Record<string, string>, settings?: Partial<EditorSettings>) {
  const params = new URLSearchParams(query);
  if (settings) params.set('settings', JSON.stringify(settings));
  return page.goto(`/?${params.toString()}`);
}

/** Opens Transform from the main menu and returns the languages it lists and the selected one;
 *  closes the dialog. */
async function languages(page: Page) {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator('.jse-config').click();
  await expect(page.locator('.jse-query-language').first()).toBeVisible();
  const listed = await page.locator('.jse-query-language').allTextContents();
  const selected = await page.locator('.jse-query-language.selected').allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.locator('.jse-query-language')).toHaveCount(0);
  await modal(page).locator('.jse-close').click();
  await expect(modal(page)).toHaveCount(0);
  const trim = (names: string[]) => names.map((name) => name.trim());
  return { listed: trim(listed), selected: trim(selected) };
}

/** Picks `language` in Transform and closes the dialog. */
async function pick(page: Page, language: string): Promise<void> {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await modal(page).locator('.jse-config').click();
  await page.locator('.jse-query-language', { hasText: language }).click();
  await expect(modal(page).locator('.jse-description')).toContainText(language);
  await modal(page).locator('.jse-close').click();
  await expect(modal(page)).toHaveCount(0);
}

/** Sends `changes` as the host's `settings` message and resolves with the milliseconds until the
 *  text of `selector`'s elements, joined, contains `expected` (checked every frame in the page). */
function timeSettings(
  page: Page,
  changes: Partial<EditorSettings>,
  selector: string,
  expected: string,
): Promise<number> {
  return page.evaluate(
    ([next, where, text]) =>
      new Promise<number>((resolve, reject) => {
        const start = performance.now();
        window.devHost!.setSettings(next);
        const check = () => {
          const shown = Array.from(
            document.querySelectorAll<HTMLElement>(where),
            (e) => e.textContent,
          ).join('|');
          const elapsed = performance.now() - start;
          if (shown.includes(text)) resolve(elapsed);
          else if (elapsed > 5_000) reject(new Error(`"${text}" not shown in ${where}: ${shown}`));
          else requestAnimationFrame(check);
        };
        check();
      }),
    [changes, selector, expected] as const,
  );
}

test.describe('criterion 7: the query language Transform starts with (Q1)', () => {
  test('the first dialog starts with the setting, and a picked language stays when it changes', async ({
    page,
  }) => {
    await open(page, {}, { defaultQueryLanguage: 'jmespath' });
    await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
    expect((await languages(page)).selected).toEqual(['JMESPath']);

    await pick(page, 'JSONPath (RFC 9535)');
    await page.evaluate(() => window.devHost!.setSettings({ defaultQueryLanguage: 'lodash' }));
    expect((await languages(page)).selected).toEqual(['JSONPath (RFC 9535)']);

    // A new tab starts with the new value.
    await open(page, {}, { defaultQueryLanguage: 'lodash' });
    await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
    expect((await languages(page)).selected).toEqual(['Lodash']);
  });

  test('a change reaches a tab whose language has not been picked (A2)', async ({ page }) => {
    await open(page, {});
    await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
    expect((await languages(page)).selected).toEqual(['JSONQuery']);
    await page.evaluate(() => window.devHost!.setSettings({ defaultQueryLanguage: 'jmespath' }));
    expect((await languages(page)).selected).toEqual(['JMESPath']);
  });

  test('Lodash on a document above the threshold starts with JSONQuery', async ({ page }) => {
    // The sample is a few hundred bytes: a threshold of 100 bytes puts it above.
    await open(page, {}, { defaultQueryLanguage: 'lodash', thresholdBytes: 100 });
    await expect(page.locator('.jse-tree-mode')).toContainText('COBOL');
    const { listed, selected } = await languages(page);
    expect(selected).toEqual(['JSONQuery']);
    expect(listed).not.toContain('Lodash');
    expect(listed).not.toContain('JavaScript');
    expect(listed).not.toContain('JSONPath (RFC 9535)');

    // The threshold is a setting too (T1): raised above the document, Lodash is back and selected.
    await page.evaluate(() => window.devHost!.setSettings({ thresholdBytes: 5 * 1024 * 1024 }));
    const raised = await languages(page);
    expect(raised.listed).toContain('Lodash');
    expect(raised.selected).toEqual(['Lodash']);
  });
});

test.describe('criterion 9: display settings (D1, D2)', () => {
  const NESTED =
    '[\n  {"id": 1, "meta": {"a": 1, "b": "x"}},\n  {"id": 2, "meta": {"a": 2, "b": "y"}}\n]\n';
  const ESCAPES = '[\n  {"s": "a\\nb", "u": "é"}\n]\n';

  test('flattenColumns off shows a nested object in one table column', async ({ page }) => {
    await open(page, { mode: 'table', text: NESTED });
    const headers = page.locator('.jse-table-mode th');
    await expect(headers).toContainText(['id', 'meta.a', 'meta.b']);

    const elapsed = await timeSettings(
      page,
      { flattenColumns: false },
      '.jse-table-mode th',
      '|meta',
    );
    expect(elapsed).toBeLessThan(500);
    await expect(headers.filter({ hasText: 'meta.a' })).toHaveCount(0);

    const host = await page.evaluate(() => ({
      text: window.devHost!.text,
      edits: window.devHost!.edits.length,
    }));
    expect(host).toEqual({ text: NESTED, edits: 0 });

    // And back.
    await page.evaluate(() => window.devHost!.setSettings({ flattenColumns: true }));
    await expect(headers).toContainText(['id', 'meta.a', 'meta.b']);
  });

  for (const mode of ['tree', 'table'] as const) {
    test(`escaping shows a\\nb and \\u00e9 in ${mode} mode and leaves text mode as written`, async ({
      page,
    }) => {
      await open(page, { mode, text: ESCAPES });
      const values = `.jse-${mode}-mode .jse-value`;
      await expect(page.locator(values).first()).toBeVisible();
      const plain = await page.locator(values).allTextContents();
      expect(plain.join('|')).not.toContain('\\u00e9');
      expect(plain.join('|')).not.toContain('a\\nb');

      const control = await timeSettings(page, { escapeControlCharacters: true }, values, 'a\\nb');
      expect(control).toBeLessThan(500);
      const unicode = await timeSettings(
        page,
        { escapeUnicodeCharacters: true },
        values,
        '\\u00e9',
      );
      expect(unicode).toBeLessThan(500);

      // The data is the same: the editor's and the host's, and no edit went to the host.
      const state = await page.evaluate(() => ({
        text: window.devHost!.text,
        edits: window.devHost!.edits.length,
      }));
      expect(state).toEqual({ text: ESCAPES, edits: 0 });

      // Text mode shows the document's text as written (D3), whatever the settings.
      await page
        .getByRole('toolbar', { name: 'Editor' })
        .getByRole('button', { name: 'Text' })
        .click();
      await expect(page.locator('.jse-text-mode .cm-content')).toContainText('"u": "é"');
      await expect(page.locator('.jse-text-mode .cm-content')).toContainText('"s": "a\\nb"');
      // A change while text mode shows keeps the text as written too.
      await page.evaluate(() => window.devHost!.setSettings({ escapeUnicodeCharacters: false }));
      await page.evaluate(() => window.devHost!.setSettings({ escapeUnicodeCharacters: true }));
      await expect(page.locator('.jse-text-mode .cm-content')).toContainText('"u": "é"');
      expect(await page.evaluate(() => window.devHost!.edits.length)).toBe(0);

      // Back in the mode it was, the values show escaped again.
      const back = mode === 'tree' ? 'Tree' : 'Table';
      await page
        .getByRole('toolbar', { name: 'Editor' })
        .getByRole('button', { name: back })
        .click();
      await expect(page.locator(values).filter({ hasText: '\\u00e9' })).toHaveCount(1);
      expect(await page.evaluate(() => window.devHost!.text)).toBe(ESCAPES);
      expect(await page.evaluate(() => window.devHost!.edits.length)).toBe(0);
    });
  }
});
