// Spec 011 criteria 4, 5, 6, 8 and 10 (011 T4) on the standalone page: JavaScript and Lodash in the
// library's Transform dialog, run in the sealed QuickJS engine. The page is served under the CHR
// JSON editor webview's CSP with 'wasm-unsafe-eval' (fixtures.ts), every request to another origin
// is blocked and fails the test, and any CSP violation fails it too, so a query that reached the
// page's `eval` or the network would show here. The VS Code half (CSP, write-back) is 011 T5's.
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test';
import JSON5 from 'json5';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures';

const QUERY_DIR = path.join(__dirname, '..', 'query');
const SEALED_DIR = path.join(QUERY_DIR, 'sealed');
const TIME_MESSAGE = 'The query was stopped after 5 seconds.';
const MEMORY_MESSAGE = 'The query used more than 256 MiB and was stopped.';
const DATA = [
  { name: 'Ana', age: 34 },
  { name: 'Bruno', age: 27 },
];

type Language = 'JavaScript' | 'Lodash';
const LANGUAGES: Language[] = ['JavaScript', 'Lodash'];

declare global {
  interface Window {
    chrSealedEval?: unknown;
    chrSealedFunction?: unknown;
    /** Every HostAdapter method the UI called since `spyOnHost`, by name. */
    chrHostCalls?: string[];
  }
}

async function open(page: Page, data: unknown = DATA): Promise<void> {
  await page.goto(`/?mode=tree&text=${encodeURIComponent(JSON.stringify(data, null, 2))}`);
  await expect(page.locator('.jse-tree-mode')).toBeVisible();
}

const modal = (page: Page) => page.locator('dialog.jse-transform-modal');
const queryBox = (page: Page) => modal(page).locator('textarea.jse-query');
const transformButton = (page: Page) =>
  modal(page).getByRole('button', { name: 'Transform', exact: true });
const previewData = (page: Page) => modal(page).locator('.jse-preview-data');
const previewError = (page: Page) => modal(page).locator('.jse-preview.jse-error');

/** Opens the Transform dialog from the main menu and picks `language`. */
async function openTransform(page: Page, language?: Language): Promise<void> {
  await page.locator('.jse-tree-mode .jse-transform').click();
  await expect(modal(page)).toBeVisible();
  if (!language) return;
  await modal(page).locator('.jse-config').click();
  await page.locator('.jse-query-language', { hasText: language }).click();
  await expect(modal(page).locator('.jse-description')).toContainText(language);
}

/** The preview's tree as `key: value` pairs of its top level (the library's tree mode). */
async function previewEntries(page: Page): Promise<Record<string, string>> {
  const lines = (await previewData(page).innerText()).split('\n').map((line) => line.trim());
  const entries: Record<string, string> = {};
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1] === ':') entries[lines[i]!] = lines[i + 2]!;
  }
  return entries;
}

/** Records every HostAdapter call the UI makes from now on (criterion 4: the host gets nothing). */
async function spyOnHost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window.devHost! as unknown as Record<string, unknown>;
    const calls: string[] = (window.chrHostCalls = []);
    let proto: object | null = host;
    const names = new Set<string>();
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    for (const name of names) {
      const value = host[name];
      if (name === 'constructor' || typeof value !== 'function') continue;
      host[name] = (...args: unknown[]) => {
        calls.push(name);
        return (value as (...a: unknown[]) => unknown).apply(host, args);
      };
    }
  });
}

/** The page's HTML with the dialog's preview emptied (criterion 4). A query box's text is its
 *  `value`, which the HTML does not hold. */
const pageOutsidePreview = (page: Page) =>
  page.evaluate(() => {
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.jse-preview, .jse-preview-data').forEach((preview) => {
      preview.replaceChildren();
      preview.className = 'preview';
    });
    return copy.outerHTML;
  });

/** Milliseconds since the last run of a query started (`chr:query-run`, App.svelte). */
const sinceLastRun = (page: Page) =>
  page.evaluate(() => {
    const runs = performance.getEntriesByName('chr:query-run');
    return performance.now() - runs[runs.length - 1]!.startTime;
  });

const marks = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType('mark')
        .filter((mark) => mark.name.startsWith('chr:document') || mark.name.includes('engine'))
        .map((mark) => [mark.name, mark.startTime]),
    ),
  );

async function hostUnchanged(page: Page, text: string): Promise<void> {
  expect(await page.evaluate(() => window.devHost!.edits.length)).toBe(0);
  expect(await page.evaluate(() => window.devHost!.text)).toBe(text);
}

test.describe('criterion 10: the engine loads when Transform first opens', () => {
  test('the document shows first; the dialog opens once the engine is compiled', async ({
    page,
  }) => {
    const requested: { url: string; at: number }[] = [];
    page.on('request', (request) => requested.push({ url: request.url(), at: Date.now() }));
    await open(page);
    await expect.poll(() => page.evaluate(() => window.devApp?.settled())).toBe(true);
    await page.waitForTimeout(500);
    expect(await marks(page)).toEqual({ 'chr:document-shown': expect.any(Number) as number });
    expect(requested.map((r) => r.url).filter((url) => /engine|emscripten/.test(url))).toEqual([]);

    // When the dialog element appears, relative to the engine's compile mark.
    await page.evaluate(() => {
      new MutationObserver((_records, observer) => {
        if (!document.querySelector('dialog.jse-transform-modal')) return;
        performance.mark('test:dialog-shown');
        observer.disconnect();
      }).observe(document.body, { childList: true, subtree: true });
    });
    const clickedAt = Date.now();
    await openTransform(page);
    const times = await page.evaluate(() =>
      Object.fromEntries(
        ['chr:document-shown', 'chr:query-engine-compiled', 'test:dialog-shown'].map((name) => [
          name,
          performance.getEntriesByName(name)[0]?.startTime,
        ]),
      ),
    );
    expect(times['chr:document-shown']).toBeLessThan(times['chr:query-engine-compiled']!);
    expect(times['chr:query-engine-compiled']).toBeLessThanOrEqual(times['test:dialog-shown']!);
    const engineRequests = requested.filter((r) => /engine|emscripten/.test(r.url));
    expect(engineRequests.length).toBeGreaterThan(0);
    for (const r of engineRequests) expect(r.at).toBeGreaterThanOrEqual(clickedAt);

    // Later dialogs open at once; the engine is compiled once.
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeHidden();
    await openTransform(page, 'JavaScript');
    await expect(previewData(page)).toContainText('2 items');
    expect(
      await page.evaluate(() => performance.getEntriesByName('chr:query-engine-compiled').length),
    ).toBe(1);
  });

  test('the context menu and text mode wait for the engine too', async ({ page }) => {
    await open(page);
    // Select the whole document, then the context menu's Transform.
    await page.getByText('name : Ana').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+q');
    await page.locator('.jse-contextmenu button', { hasText: 'Transform' }).click();
    await expect(modal(page)).toBeVisible();
    expect(await marks(page)).toHaveProperty('chr:query-engine-compiled');

    await page.goto(`/?mode=text&text=${encodeURIComponent(JSON.stringify(DATA))}`);
    await expect(page.locator('.jse-text-mode')).toBeVisible();
    await page.locator('.jse-text-mode .jse-transform').click();
    await expect(modal(page)).toBeVisible();
    expect(await marks(page)).toHaveProperty('chr:query-engine-compiled');
  });
});

test.describe('criterion 8: languages and wizard', () => {
  test('the dialog lists the five languages in order, JSONQuery first', async ({ page }) => {
    await open(page);
    await openTransform(page);
    await expect(modal(page).locator('.jse-description a').first()).toHaveAttribute(
      'href',
      /^https:\/\/jsonquerylang\.org/,
    );
    await modal(page).locator('.jse-config').click();
    await expect(page.locator('.jse-query-language')).toHaveText([
      'JSONQuery',
      'JMESPath',
      'JSONPath (Goessner)',
      'JavaScript',
      'Lodash',
    ]);
    await expect(page.locator('.jse-query-language.selected')).toHaveText('JSONQuery');
  });

  for (const language of LANGUAGES) {
    test(`${language}: the wizard writes createQuery's text and the preview shows its result`, async ({
      page,
    }) => {
      // The corpus case holds the library's createQuery text for these wizard fields (011 T2).
      const dir = path.join(QUERY_DIR, `${language.toLowerCase()}-wizard-filter-sort-pick`);
      const input: unknown = JSON5.parse(readFileSync(path.join(dir, 'input.json5'), 'utf8'));
      const expected: unknown = JSON5.parse(readFileSync(path.join(dir, 'expected.json5'), 'utf8'));
      const created = readFileSync(path.join(dir, 'query.js'), 'utf8');
      await open(page, input);
      await openTransform(page, language);

      await choose(modal(page).locator('.jse-filter-path'), 'city');
      await choose(modal(page).locator('.jse-filter-relation'), '!=');
      await modal(page).locator('input.jse-filter-value').fill('Porto');
      await choose(modal(page).locator('.jse-sort-path'), 'name');
      await choose(modal(page).locator('.jse-sort-direction'), 'descending');
      await choose(modal(page).locator('.jse-projection-paths'), 'name');
      await choose(modal(page).locator('.jse-projection-paths'), 'age');

      await expect(queryBox(page)).toHaveValue(created.replace(/\n$/, ''));
      await expect(previewData(page)).toContainText('3 items');
      await transformButton(page).click();
      await expect
        .poll(async () => JSON.parse(await page.evaluate(() => window.devHost!.text)) as unknown)
        .toEqual(expected);
    });
  }
});

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

test.describe('criterion 4: sealed', () => {
  const sealed = readdirSync(SEALED_DIR).filter((file) => file.endsWith('.js'));

  test('the sealed queries exist', () => {
    expect(sealed).toEqual(['eval.js', 'globals.js']);
  });

  for (const file of sealed) {
    for (const language of LANGUAGES) {
      test(`${language}: ${file} sees "undefined" everywhere, and touches nothing outside`, async ({
        page,
      }) => {
        const query = readFileSync(path.join(SEALED_DIR, file), 'utf8');
        const keys = [...query.matchAll(/^\s+"([^"]+)": /gm)].map((match) => match[1]!);
        expect(keys.length).toBeGreaterThan(0);
        const text = JSON.stringify(DATA, null, 2);
        await open(page);
        await openTransform(page, language);
        await expect(previewData(page)).toContainText('2 items');
        await spyOnHost(page);
        const before = await pageOutsidePreview(page);

        await queryBox(page).fill(query);
        await expect(previewData(page)).toContainText(keys[0]!);
        expect(await previewEntries(page)).toEqual(
          Object.fromEntries(keys.map((key) => [key, 'undefined'])),
        );
        expect(await pageOutsidePreview(page)).toBe(before);
        expect(await page.evaluate(() => window.chrHostCalls)).toEqual([]);
        // eval and Function ran inside the engine: nothing they set reached the page.
        expect(
          await page.evaluate(() => [typeof window.chrSealedEval, typeof window.chrSealedFunction]),
        ).toEqual(['undefined', 'undefined']);
        await hostUnchanged(page, text);
      });
    }
  }
});

test.describe('criterion 5: limits', () => {
  const NEXT = 'function query (data) { return data.map(item => item.name) }';
  const probes: {
    name: string;
    language: Language;
    query: string;
    messages: string[];
    within: number;
  }[] = [
    {
      name: 'an endless loop',
      language: 'JavaScript',
      query: 'function query (data) { while (true) {} }',
      messages: [TIME_MESSAGE],
      within: 6_000,
    },
    {
      name: 'an endless loop inside Lodash',
      language: 'Lodash',
      query: 'function query (data) { _.forEach([1], () => { while (true) {} }) }',
      messages: [TIME_MESSAGE],
      within: 6_000,
    },
    {
      // Large blocks (16 MiB each), so the memory limit, not the deadline, ends it: small objects
      // can end on either limit (011 T1 REPORT §3), and 1e6-element `fill` blocks took 8.4 s in
      // Node and up to 17 s here on a loaded 4-core machine, as QuickJS's collector rescans the
      // growing heap (recorded in the 011 T4 PR).
      name: 'a query that keeps allocating',
      language: 'JavaScript',
      query:
        'function query (data) {\n  const kept = []\n  while (true) kept.push(new Float64Array(1 << 21))\n}',
      messages: [MEMORY_MESSAGE],
      within: 15_000,
    },
    {
      name: 'catastrophic regex backtracking',
      language: 'JavaScript',
      query: "function query (data) { return /^(a+)+$/.test('a'.repeat(32) + 'b') }",
      messages: [TIME_MESSAGE, MEMORY_MESSAGE],
      within: 15_000,
    },
    {
      name: 'a huge repeat',
      language: 'JavaScript',
      query: "function query (data) { return 'x'.repeat(2 ** 28).length }",
      messages: [TIME_MESSAGE, MEMORY_MESSAGE],
      within: 15_000,
    },
    {
      name: 'a huge join',
      language: 'JavaScript',
      query: "function query (data) { return Array(3e7).fill('ab').join(',').length }",
      messages: [TIME_MESSAGE, MEMORY_MESSAGE],
      within: 15_000,
    },
    {
      name: 'a sort with a comparator over 3 million numbers, repeated',
      language: 'JavaScript',
      query:
        'function query (data) {\n  const numbers = Array.from({ length: 3e6 }, (_, i) => (i * 7919) % 3e6)\n  while (true) numbers.slice().sort((a, b) => a - b)\n}',
      messages: [TIME_MESSAGE, MEMORY_MESSAGE],
      within: 15_000,
    },
  ];

  for (const probe of probes) {
    test(`${probe.name} is stopped, the editor responds and the next query runs`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const text = JSON.stringify(DATA, null, 2);
      await open(page);
      await openTransform(page, probe.language);
      await expect(previewData(page)).toContainText('2 items');

      await queryBox(page).fill(probe.query);
      await expect(previewError(page)).toBeVisible({ timeout: probe.within + 2_000 });
      expect(await sinceLastRun(page)).toBeLessThan(probe.within);
      const message = await previewError(page).innerText();
      expect(
        probe.messages.some((m) => message === `Error: ${m}`),
        message,
      ).toBe(true);
      await expect(transformButton(page)).toBeDisabled();

      // The editor responds to a click within 500 ms: the language list opens.
      const clicked = Date.now();
      await modal(page).locator('.jse-config').click();
      await expect(page.locator('.jse-query-language').first()).toBeVisible();
      expect(Date.now() - clicked).toBeLessThan(500);
      await modal(page).locator('.jse-config').click();

      await queryBox(page).fill(NEXT);
      await expect(previewData(page)).toContainText('Bruno');
      await hostUnchanged(page, text);
    });
  }
});

test.describe('criterion 6: errors', () => {
  const cases: { name: string; language: Language; query: string; message: RegExp }[] = [
    {
      name: 'a syntax error',
      language: 'JavaScript',
      query: 'function query (data) { return data.filter(item => }',
      message: /^Error: SyntaxError: /,
    },
    {
      name: 'a thrown error',
      language: 'JavaScript',
      query: "function query (data) { throw new Error('no query today') }",
      message: /^Error: no query today$/,
    },
    {
      name: 'a missing query function',
      language: 'JavaScript',
      query: 'function filter (data) { return data }',
      message: /^Error: Cannot execute query: expecting a function named 'query' but is undefined$/,
    },
    {
      name: 'a Lodash chain without .value()',
      language: 'Lodash',
      query: 'function query (data) { return _.chain(data).map(item => item.age) }',
      message: /^Error: Cannot execute query: Lodash _\.chain\(\.\.\.\) must end with \.value\(\)$/,
    },
  ];

  for (const c of cases) {
    test(`${c.name} shows its message, Transform is disabled, and the document is unchanged`, async ({
      page,
    }) => {
      const text = JSON.stringify(DATA, null, 2);
      await open(page);
      await openTransform(page, c.language);
      await expect(previewData(page)).toContainText('2 items');
      await queryBox(page).fill(c.query);
      await expect(previewError(page)).toHaveText(c.message);
      await expect(transformButton(page)).toBeDisabled();
      await hostUnchanged(page, text);
    });
  }
});
