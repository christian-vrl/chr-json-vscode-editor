// Gate for 007 T3 (`pnpm test:web`): spec 007 criterion 3 on every compare fixture (tests/compare),
// and the theme part of criterion 9. The compare page (packages/app-shell/compare.html) runs over a
// DevCompareHostAdapter holding the fixture's two documents, under the webview CSP with other
// origins blocked (fixtures.ts).
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test';
import type {
  DevCompareDocument,
  DevCompareHostAdapter,
} from '../../packages/app-shell/src/dev-compare-host-adapter.js';
import { compareCases, type CompareCase, type CompareSideFixture } from '../compare/cases';
import { expect, test } from './fixtures';
import { applyTheme, computedColor, expectContrast, loadTheme, THEMES } from './theme-helpers';

// Set by the standalone compare page (packages/app-shell/src/compare-main.ts).
declare global {
  interface Window {
    chrCompareDocuments?: { left: DevCompareDocument; right: DevCompareDocument };
    devCompareHost?: DevCompareHostAdapter;
  }
}

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
const DIFF_CLASSES = ['chr-diff-added', 'chr-diff-removed', 'chr-diff-changed', 'chr-diff-inside'];

/** Opens the compare page over two documents. */
async function openCompare(
  page: Page,
  left: CompareSideFixture & { writable?: boolean },
  right: CompareSideFixture & { writable?: boolean },
): Promise<void> {
  await page.addInitScript(
    (documents) => {
      window.chrCompareDocuments = documents;
    },
    { left, right },
  );
  await page.goto('/compare.html');
  await expect(page.getByRole('status')).not.toHaveText('');
}

function panel(page: Page, side: Side): Locator {
  return page.locator(`.side.${side}`);
}

function node(page: Page, side: Side, pointer: string): Locator {
  return panel(page, side).locator(`.jse-json-node[data-path="${encodeURIComponent(pointer)}"]`);
}

/** The JSON Pointers of `pointer`'s ancestors, root first. */
function ancestors(pointer: string): string[] {
  const tokens = pointer === '' ? [] : pointer.slice(1).split('/');
  return tokens.map((_, n) => (n === 0 ? '' : '/' + tokens.slice(0, n).join('/')));
}

/** Per side, the chr-diff-* classes criterion 3 asks for, by JSON Pointer. */
function expectedMarks(expected: CompareCase['expected']): Record<Side, Record<string, string[]>> {
  const marks: Record<Side, Record<string, string[]>> = { left: {}, right: {} };
  const add = (side: Side, pointer: string, cls: string) => {
    const list = (marks[side][pointer] ??= []);
    if (!list.includes(cls)) list.push(cls);
  };
  for (const d of expected) {
    for (const side of SIDES) {
      const pointer = side === 'left' ? d.leftPath : d.rightPath;
      if (pointer === undefined) continue;
      add(side, pointer, `chr-diff-${d.kind}`);
      for (const a of ancestors(pointer)) add(side, a, 'chr-diff-inside');
    }
  }
  for (const side of SIDES) for (const list of Object.values(marks[side])) list.sort();
  return marks;
}

/** Per side, every rendered node that has a chr-diff-* class, with those classes. */
function renderedMarks(page: Page): Promise<Record<Side, Record<string, string[]>>> {
  return page.evaluate((classes) => {
    const result: Record<'left' | 'right', Record<string, string[]>> = { left: {}, right: {} };
    for (const side of ['left', 'right'] as const) {
      const nodes = document.querySelectorAll<HTMLElement>(
        `.side.${side} .jse-json-node[data-path]`,
      );
      for (const el of Array.from(nodes)) {
        const found = Array.from(el.classList)
          .filter((c) => classes.includes(c))
          .sort();
        if (found.length > 0) result[side][decodeURIComponent(el.dataset.path ?? '')] = found;
      }
    }
    return result;
  }, DIFF_CLASSES);
}

const cases = compareCases();

test('the compare fixtures are all here', () => {
  expect(cases.map((c) => c.name)).toEqual(
    expect.arrayContaining(['equal', 'values', 'arrays', 'formats', 'comments', 'long-array']),
  );
});

for (const c of cases) {
  test(`criterion 3: ${c.name}`, async ({ page }) => {
    await openCompare(page, c.left, c.right);
    for (const side of SIDES) {
      await expect(panel(page, side).locator('.jse-tree-mode')).toBeVisible();
      await expect(panel(page, side).locator('.name')).toHaveText(c[side].name);
    }
    const n = c.expected.length;
    const status = page.getByRole('status');
    if (n === 0) {
      await expect(status).toHaveText('No differences in the data');
      await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
      expect(await renderedMarks(page)).toEqual({ left: {}, right: {} });
      return;
    }
    await expect(status).toHaveText(`${n} ${n === 1 ? 'difference' : 'differences'}`);

    // Every node on the way to a difference shows once expanded: all of them, then Next to each
    // (which also opens array sections the library renders lazily, such as items 100+).
    for (const side of SIDES) await panel(page, side).locator('.jse-expand-all').click();
    for (let i = 0; i < n; i++) {
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(status).toHaveText(
        `Difference ${i + 1} of ${n} ${n === 1 ? 'difference' : 'differences'}`,
      );
      const d = c.expected[i]!;
      for (const side of SIDES) {
        const pointer = side === 'left' ? d.leftPath : d.rightPath;
        if (pointer === undefined) continue;
        const selected = node(page, side, pointer);
        await expect(selected).toHaveClass(/\bjse-selected/);
        await expect(selected).toHaveClass(new RegExp(`\\bchr-diff-${d.kind}\\b`));
        await expect(selected).toBeInViewport();
      }
    }
    // Next wraps around to the first; Previous goes back to the last.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(status).toHaveText(new RegExp(`^Difference 1 of ${n} `));
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(status).toHaveText(new RegExp(`^Difference ${n} of ${n} `));

    // Each difference's path, and every ancestor of one, is marked, and no other node.
    expect(await renderedMarks(page)).toEqual(expectedMarks(c.expected));
  });
}

test('Previous and Next scroll a difference past the rendered part of a long array into view', async ({
  page,
}) => {
  const c = cases.find((x) => x.name === 'long-array')!;
  await openCompare(page, c.left, c.right);
  // Collapsed by default past the first level: no expanding by hand this time.
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(node(page, 'left', '/items/250')).toBeInViewport();
  await expect(node(page, 'left', '/items/250')).toHaveClass(/\bchr-diff-removed\b/);
  // The right side has no such item: it shows the array it would go into.
  await expect(node(page, 'right', '/items')).toBeInViewport();
  await page.getByRole('button', { name: 'Previous' }).click();
  for (const side of SIDES) {
    await expect(node(page, side, '/items/150/label')).toBeInViewport();
    await expect(node(page, side, '/items/150/label')).toHaveClass(/\bchr-diff-changed\b/);
  }
});

test('both panels are read-only trees: no editing, no mode switch', async ({ page }) => {
  const c = cases.find((x) => x.name === 'values')!;
  await openCompare(page, c.left, c.right);
  for (const side of SIDES) {
    const tree = panel(page, side).locator('.jse-tree-mode');
    await expect(tree).toBeVisible();
    await expect(panel(page, side).locator('.jse-group-button')).toHaveCount(0);
    await tree.getByText('London').dblclick();
    await expect(
      tree.locator('[contenteditable="true"], textarea, input:not(.jse-hidden-input)'),
    ).toHaveCount(0);
    await expect(node(page, side, '/address/city')).toHaveClass(/\bjse-readonly\b/);
  }
  expect(await page.evaluate(() => window.devCompareHost!.copies)).toEqual([]);
});

test('Copy to left and Copy to right copy the current difference through the host', async ({
  page,
}) => {
  const c = cases.find((x) => x.name === 'comments')!;
  await openCompare(page, c.left, c.right);
  const status = page.getByRole('status');
  const copyLeft = page.getByRole('button', { name: 'Copy to left' });
  const copyRight = page.getByRole('button', { name: 'Copy to right' });
  await expect(copyLeft).toBeDisabled();
  await page.getByRole('button', { name: 'Next' }).click();
  await copyLeft.click();
  await expect(status).toHaveText('Difference 1 of 3 differences');
  expect(await page.evaluate(() => window.devCompareHost!.text('left'))).toContain(
    '"target": "es2020", // newest supported',
  );
  // The current position now holds the next difference, /minify; copy it the other way.
  await expect(node(page, 'left', '/minify')).toHaveClass(/\bjse-selected/);
  await copyRight.click();
  await expect(status).toHaveText('Difference 1 of 2 differences');
  expect(await page.evaluate(() => window.devCompareHost!.text('right'))).toContain(
    '"minify": false, // smaller bundle',
  );
  // Clicking a marked node makes it the current difference.
  await node(page, 'right', '/sourcemap').getByText('external').click();
  await expect(status).toHaveText('Difference 2 of 2 differences');
  await copyLeft.click();
  await expect(status).toHaveText('Difference 1 of 1 difference');
  await copyRight.click();
  await expect(status).toHaveText('No differences in the data');
  expect(await page.evaluate(() => window.devCompareHost!.notices)).toEqual([]);
});

test('a side that is not writable offers no copy into it', async ({ page }) => {
  await openCompare(
    page,
    { name: 'a.json (HEAD)', text: '{"a": 1}', format: 'json', writable: false },
    { name: 'a.json', text: '{"a": 2}', format: 'json' },
  );
  await expect(panel(page, 'left').locator('.name')).toHaveText('a.json (HEAD)');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'Copy to left' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Copy to right' })).toBeEnabled();
});

test('an edit made elsewhere shows up, and a side that does not parse shows its error', async ({
  page,
}) => {
  await openCompare(
    page,
    { name: 'a.json', text: '[1, 2]', format: 'json' },
    { name: 'b.json5', text: '[1, 2]', format: 'json5' },
  );
  const status = page.getByRole('status');
  await expect(status).toHaveText('No differences in the data');
  await page.evaluate(() => window.devCompareHost!.setText('right', "[1, 2, 'three']"));
  await expect(status).toHaveText('1 difference');
  await expect(node(page, 'right', '/2')).toHaveClass(/\bchr-diff-added\b/);

  await page.evaluate(() => window.devCompareHost!.setText('right', '[1, 2,'));
  await expect(status).toHaveText('Not compared: a side does not parse');
  await expect(panel(page, 'right').getByRole('alert')).not.toHaveText('');
  await expect(panel(page, 'right').locator('.jse-tree-mode')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

  await page.evaluate(() => window.devCompareHost!.setText('right', '[1]'));
  await expect(status).toHaveText('1 difference');
  await expect(panel(page, 'right').getByRole('alert')).toHaveCount(0);
  await expect(node(page, 'left', '/1')).toHaveClass(/\bchr-diff-removed\b/);
});

// Criterion 9, theme part: with each captured VS Code theme, the compare page passes axe-core's
// color-contrast rule, and its difference colours are VS Code's diffEditor.* variables.
for (const name of THEMES) {
  const theme = loadTheme(name);
  const c = cases.find((x) => x.name === 'values')!;

  test.describe(`${name} theme (${theme.theme})`, () => {
    test('the compare page passes axe color-contrast with differences shown', async ({ page }) => {
      await applyTheme(page, theme);
      await openCompare(page, c.left, c.right);
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(node(page, 'left', '/spouse')).toHaveClass(/\bjse-selected/);
      await expectContrast(page);
    });

    test('difference colours come from the diffEditor variables', async ({ page }) => {
      await applyTheme(page, theme);
      await openCompare(page, c.left, c.right);
      const vars = theme.variables;
      const removed = node(page, 'left', '/spouse');
      const added = node(page, 'right', '/children');
      await expect(removed).toBeVisible();
      if (vars['--vscode-diffEditor-removedTextBackground']) {
        await expect(removed).toHaveCSS(
          'background-color',
          await computedColor(page, vars['--vscode-diffEditor-removedTextBackground']),
        );
        await expect(added).toHaveCSS(
          'background-color',
          await computedColor(page, vars['--vscode-diffEditor-insertedTextBackground']!),
        );
        await expect(node(page, 'right', '/name')).toHaveCSS(
          'background-color',
          await computedColor(page, vars['--vscode-diffEditor-insertedLineBackground']!),
        );
      } else {
        // High contrast: borders only.
        await expect(removed).toHaveCSS(
          'outline-color',
          await computedColor(page, vars['--vscode-diffEditor-removedTextBorder']!),
        );
        await expect(added).toHaveCSS(
          'outline-color',
          await computedColor(page, vars['--vscode-diffEditor-insertedTextBorder']!),
        );
        await expect(node(page, 'right', '/name')).toHaveCSS('outline-style', 'dashed');
        await expect(removed).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
    });
  });
}
