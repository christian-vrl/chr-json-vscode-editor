// Theme helpers for `pnpm test:web` (003 T9, shared with the compare page's tests in 007 T3): load a
// theme captured from VS Code (tests/themes/*.json, scripts/capture-themes.ts), apply it to a page
// as a webview gets it, and run axe-core's color-contrast rule.
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export interface CapturedTheme {
  theme: string;
  bodyClass: string;
  dataset: Record<string, string>;
  variables: Record<string, string>;
}

const THEME_DIR = path.resolve(__dirname, '../themes');
export const THEMES = ['light', 'dark', 'hc'] as const;

export function loadTheme(name: string): CapturedTheme {
  return JSON.parse(readFileSync(path.join(THEME_DIR, `${name}.json`), 'utf8')) as CapturedTheme;
}

/**
 * Applies a captured theme the way a VS Code webview does: variables on <html>, class and data on
 * <body>. Init scripts run before the parser creates either element, so this waits for them.
 */
export async function applyTheme(page: Page, theme: CapturedTheme): Promise<void> {
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
export function computedColor(page: Page, value: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement('div');
    probe.style.color = color;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, value);
}

export async function expectContrast(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  const failures = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`),
  );
  expect(failures).toEqual([]);
  // The rule really ran and checked text, so an empty violation list means something.
  expect(results.passes.flatMap((pass) => pass.nodes).length).toBeGreaterThan(0);
}
