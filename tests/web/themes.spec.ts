// Gate for 003 T9 (spec 003 criterion 7, `pnpm test:web`): with the CSS variables VS Code gives a
// webview under each default theme (tests/themes/*.json, captured by scripts/capture-themes.ts),
// the app-shell passes axe-core's color-contrast rule in every mode, and its colours come from
// those variables rather than from the library's built-in light theme.
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

interface CapturedTheme {
  theme: string;
  bodyClass: string;
  dataset: Record<string, string>;
  variables: Record<string, string>;
}

const THEME_DIR = path.resolve(__dirname, '../themes');
const THEMES = ['light', 'dark', 'hc'] as const;
const MODE_ROOT = { tree: '.jse-tree-mode', text: '.jse-text-mode', table: '.jse-table-mode' };

function loadTheme(name: string): CapturedTheme {
  return JSON.parse(readFileSync(path.join(THEME_DIR, `${name}.json`), 'utf8')) as CapturedTheme;
}

/**
 * Applies a captured theme the way a VS Code webview does: variables on <html>, class and data on
 * <body>. Init scripts run before the parser creates either element, so this waits for them.
 */
async function applyTheme(page: Page, theme: CapturedTheme): Promise<void> {
  await page.addInitScript((captured: CapturedTheme) => {
    const apply = (): boolean => {
      const html = document.documentElement;
      if (!html) return false;
      for (const [name, value] of Object.entries(captured.variables)) {
        html.style.setProperty(name, value);
      }
      if (!document.body) return false;
      document.body.className = captured.bodyClass;
      Object.assign(document.body.dataset, captured.dataset);
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }, theme);
}

/** The colour a CSS colour value computes to, e.g. `#121314` → `rgb(18, 19, 20)`. */
function computedColor(page: Page, value: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement('div');
    probe.style.color = color;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, value);
}

async function expectContrast(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const failures = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
  );
  expect(failures).toEqual([]);
  // The rule really ran and checked text, so an empty violation list means something.
  expect(results.passes.flatMap((pass) => pass.nodes).length).toBeGreaterThan(0);
}

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
