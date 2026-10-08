// Gate for 003 T2 (`pnpm test:web`): the standalone page loads app-shell over a DevHostAdapter
// with every other origin blocked, and the toolbar switches tree, text and table without changing
// the document. The offline fixture aborts foreign requests; these tests also record every request
// and every failed one, so a page that tried to reach the network fails here even if the abort
// went unnoticed.
/// <reference lib="dom" />
import type { Page } from '@playwright/test';
import type { DevHostAdapter } from '../../packages/app-shell/src/dev-host-adapter.js';
import { expect, test } from './fixtures';

// Set by the standalone page (packages/app-shell/src/main.ts); page.evaluate callbacks run there.
declare global {
  interface Window {
    devHost?: DevHostAdapter;
  }
}

const MODE_ROOT = { tree: '.jse-tree-mode', text: '.jse-text-mode', table: '.jse-table-mode' };

function watchNetwork(page: Page) {
  const requests: string[] = [];
  const failed: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) =>
    failed.push(`${request.url()} ${request.failure()?.errorText ?? ''}`),
  );
  return { requests, failed };
}

const hostText = (page: Page) => page.evaluate(() => window.devHost!.text);
const hostEdits = (page: Page) => page.evaluate(() => window.devHost!.edits.length);

test('loads the editor with no request leaving the local origin', async ({
  page,
  baseURL,
  blockedRequests,
}) => {
  const network = watchNetwork(page);
  await page.goto('/');
  await expect(page.locator(MODE_ROOT.tree)).toBeVisible();
  await expect(page.locator(MODE_ROOT.tree)).toContainText('COBOL');
  await page.waitForLoadState('networkidle');
  const origin = new URL(baseURL!).origin;
  expect(network.requests.length).toBeGreaterThan(0);
  expect(network.requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
  expect(network.failed).toEqual([]);
  expect(blockedRequests).toEqual([]);
});

test('the editor page cannot reach another origin: the fixture aborts it', async ({
  page,
  blockedRequests,
}) => {
  await page.goto('/');
  await expect(page.locator(MODE_ROOT.tree)).toBeVisible();
  const url = 'https://example.com/';
  const failure = page.waitForEvent('requestfailed', (request) => request.url() === url);
  // no-cors, so without the block this request would succeed wherever the network is reachable.
  const outcome = await page.evaluate(async (target) => {
    try {
      await fetch(target, { mode: 'no-cors' });
      return 'reached';
    } catch {
      return 'failed';
    }
  }, url);
  expect(outcome).toBe('failed');
  // Only the fixture's abort fails this way (Chromium appends `.Inspector` for DevTools blocks).
  expect((await failure).failure()?.errorText).toMatch(
    /^net::ERR_BLOCKED_BY_CLIENT(\.Inspector)?$/,
  );
  expect(blockedRequests).toEqual([url]);
});

test('the toolbar switches tree, text and table without changing the document', async ({
  page,
  blockedRequests,
}) => {
  await page.goto('/');
  await expect(page.locator(MODE_ROOT.tree)).toBeVisible();
  const before = await hostText(page);
  const toolbar = page.getByRole('toolbar', { name: 'Editor' });

  for (const [label, mode, shows] of [
    ['Text', 'text', '"language": "Analytical Engine"'],
    ['Table', 'table', 'Analytical Engine'],
    ['Tree', 'tree', 'Analytical Engine'],
  ] as const) {
    await toolbar.getByRole('button', { name: label }).click();
    await expect(page.locator(MODE_ROOT[mode])).toBeVisible();
    await expect(page.locator(MODE_ROOT[mode])).toContainText(shows);
    for (const other of ['Tree', 'Text', 'Table']) {
      await expect(toolbar.getByRole('button', { name: other })).toHaveAttribute(
        'aria-pressed',
        String(other === label),
      );
    }
  }

  expect(await hostEdits(page)).toBe(0);
  expect(await hostText(page)).toBe(before);
  expect(blockedRequests).toEqual([]);
});

test('starts in the mode the host asks for and follows setMode from the host', async ({ page }) => {
  await page.goto('/?mode=table');
  await expect(page.locator(MODE_ROOT.table)).toBeVisible();
  await page.evaluate(() => window.devHost!.setMode('text'));
  await expect(page.locator(MODE_ROOT.text)).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: 'Editor' });
  await expect(toolbar.getByRole('button', { name: 'Text' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a text-mode edit reaches the host and an external change reaches the editor', async ({
  page,
}) => {
  await page.goto('/?mode=text');
  const editor = page.locator(`${MODE_ROOT.text} .cm-content`);
  await expect(editor).toContainText('COBOL');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' ');
  await expect.poll(() => hostEdits(page)).toBe(1);
  expect(await hostText(page)).toMatch(/\n $/);

  await page.evaluate(() => window.devHost!.externalChange('{ "changed": "elsewhere" }'));
  await expect(editor).toContainText('"changed": "elsewhere"');
  expect(await hostEdits(page)).toBe(1);
});
