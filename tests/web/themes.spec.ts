// Gate for 003 T9 (spec 003 criterion 7, `pnpm test:web`): with the CSS variables VS Code gives a
// webview under each default theme (tests/themes/*.json, captured by scripts/capture-themes.ts),
// the app-shell passes axe-core's color-contrast rule in every mode, and its colours come from
// those variables rather than from the library's built-in light theme.
/// <reference lib="dom" />
import { expect, test } from './fixtures';
import { applyTheme, computedColor, expectContrast, loadTheme, THEMES } from './theme-helpers';

const MODE_ROOT = { tree: '.jse-tree-mode', text: '.jse-text-mode', table: '.jse-table-mode' };

for (const name of THEMES) {
  const theme = loadTheme(name);

  test.describe(`${name} theme (${theme.theme})`, () => {
    for (const mode of ['tree', 'text', 'table'] as const) {
      test(`${mode} mode passes axe color-contrast`, async ({ page }) => {
        await applyTheme(page, theme);
        await page.goto(`/?mode=${mode}`);
        await expect(page.locator(MODE_ROOT[mode])).toBeVisible();
        await expect(page.locator(MODE_ROOT[mode])).toContainText('COBOL');
        await expectContrast(page);
      });
    }

    // 004 T5: inline schema errors and the toolbar's schema status keep the contrast.
    for (const mode of ['tree', 'text', 'table'] as const) {
      test(`${mode} mode with schema errors passes axe color-contrast`, async ({ page }) => {
        await applyTheme(page, theme);
        await page.goto(`/?mode=${mode}`);
        await expect(page.locator(MODE_ROOT[mode])).toContainText('COBOL');
        await page.evaluate(() =>
          window.devHost!.validation(
            { name: 'draft-07', assumed: true, switchable: true },
            {
              kind: 'errors',
              errors: [{ instancePath: '/1/year', keyword: 'type', message: 'must be string' }],
            },
          ),
        );
        await expect(page.getByRole('combobox', { name: 'Schema dialect' })).toBeVisible();
        await expect(
          page.locator(
            mode === 'text'
              ? '.cm-lintRange-warning'
              : `${MODE_ROOT[mode]} .jse-validation-warning`,
          ),
        ).not.toHaveCount(0);
        await expectContrast(page);
      });
    }

    test('a document that was not validated says why, with contrast', async ({ page }) => {
      await applyTheme(page, theme);
      await page.goto('/');
      await expect(page.locator(MODE_ROOT.tree)).toContainText('COBOL');
      await page.evaluate(() =>
        window.devHost!.validation(
          { name: 'draft-07', assumed: true, switchable: true },
          { kind: 'skipped', reason: 'The schema does not compile' },
        ),
      );
      await expect(page.getByText('Not validated: The schema does not compile')).toBeVisible();
      await expectContrast(page);
    });

    test('tree mode with a selected value passes axe color-contrast', async ({ page }) => {
      await applyTheme(page, theme);
      await page.goto('/');
      await page.locator(MODE_ROOT.tree).getByText('COBOL').click();
      await expect(page.locator(`${MODE_ROOT.tree} .jse-selected`).first()).toBeVisible();
      await expectContrast(page);
    });

    test('the editor and toolbar take their colours from the theme', async ({ page }) => {
      await applyTheme(page, theme);
      await page.goto('/');
      await expect(page.locator(MODE_ROOT.tree)).toBeVisible();
      const vars = theme.variables;
      const background = await computedColor(page, vars['--vscode-editor-background']!);
      const foreground = await computedColor(page, vars['--vscode-foreground']!);
      await expect(page.locator(MODE_ROOT.tree)).toHaveCSS('background-color', background);
      await expect(page.getByRole('toolbar', { name: 'Editor' })).toHaveCSS('color', foreground);
    });
  });
}
