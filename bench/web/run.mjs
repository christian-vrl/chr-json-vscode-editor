// Chromium half of the 003 T11 benchmark: the app-shell standalone page (packages/app-shell/dist/web,
// built by `pnpm build`) with the same vanilla-jsoneditor that 003 T5 will mount in the webview.
// For each benchmark file, in a fresh page:
//   render — the page's DevHostAdapter hands the document text to the UI as a host `update`
//            (`externalChange`), the path the webview takes when the host sends a document. Timed
//            until the tree shows the document's root ("<n> items", which needs the whole text
//            parsed) and the next frame is painted.
//   edit   — one tree edit: double-click the first record's "name" value, type a new value, press
//            Enter. Timed from the Enter keydown to the first frame that shows the new value
//            (`ms`), and to the UI handing the patch to the host (`toHostMs`, `HostAdapter.save`).
//            Applying it to the text is the host's part (the VS Code run).
// Fetching the file into the page is not timed. Results go to <out.json>.
//
//   node bench/web/run.mjs <dataDir> <out.json> [sizes...]
//
// Browsers come from `playwright install chromium`; or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
/* global window, document, requestAnimationFrame -- page.evaluate callbacks run in the page */
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { SIZES_MIB, fileName } from '../generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pageRoot = path.resolve(here, '../../packages/app-shell/dist/web');
const RUNS = 3;
const TIMEOUT_MS = 120000;

const [dataDir = 'bench/.data', out = 'bench/.results/web.json', ...sizeArgs] =
  process.argv.slice(2);
const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Serves the built page and, under /bench-data/, the benchmark files. Local only. */
function serve() {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const file = pathname.startsWith('/bench-data/')
      ? path.join(path.resolve(dataDir), path.basename(pathname))
      : path.join(pageRoot, pathname === '/' ? 'index.html' : path.normalize(pathname));
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/json',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function timeRender(page, rootLabel) {
  return page.evaluate(
    async ({ rootLabel, timeoutMs }) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const start = performance.now();
      window.devHost.externalChange(window.benchText);
      // The root's size tag; the editor may replace its tree, so it is looked up on every frame.
      const rootTag = () =>
        document.querySelector('.jse-tree-mode .jse-tag')?.textContent?.replace(/\s+/g, ' ').trim();
      while (rootTag() !== rootLabel) {
        if (performance.now() - start > timeoutMs) throw new Error(`no "${rootLabel}" in the tree`);
        await frame();
      }
      await frame();
      return performance.now() - start;
    },
    { rootLabel, timeoutMs: TIMEOUT_MS },
  );
}

async function timeEdit(page, run) {
  const value = `edited-${run}`;
  await page.evaluate((value) => {
    const edit = (window.benchEdit = {});
    // The benchmark stops at the host boundary: the change is recorded, not applied. Applying it
    // is the host's part (the VS Code run); the dev host's JSON round trip of the whole document
    // is not what VS Code does.
    window.devHost.save = (_docVersion, change) => {
      edit.savedAt ??= performance.now();
      edit.change = change;
    };
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        edit.enterAt ??= performance.now();
        // Painted: the first frame in which the tree shows the new value.
        const check = () => {
          const shown = [...document.querySelectorAll('.jse-tree-mode .jse-value')].some(
            (e) => !e.isContentEditable && e.textContent.trim() === value,
          );
          if (shown) edit.paintedAt = performance.now();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      },
      { capture: true, once: true },
    );
  }, value);
  await page
    .locator('.jse-tree-mode .jse-value', { hasText: /^\s*alpha-0\s*$/ })
    .first()
    .dblclick();
  const input = page.locator('.jse-tree-mode .jse-editable-div');
  await input.fill(value);
  await input.press('Enter');
  const result = await page.waitForFunction(
    () =>
      window.benchEdit.savedAt !== undefined &&
      window.benchEdit.paintedAt !== undefined &&
      window.benchEdit,
    undefined,
    { timeout: TIMEOUT_MS },
  );
  const { enterAt, savedAt, paintedAt, change } = await result.jsonValue();
  const patch = change.kind === 'patch' ? change.patch : [];
  if (!patch.some((op) => op.op === 'replace' && op.path === '/0/name' && op.value === value)) {
    throw new Error(`unexpected change: ${JSON.stringify(change).slice(0, 200)}`);
  }
  return { ms: paintedAt - enterAt, toHostMs: savedAt - enterAt };
}

const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const results = { chromium: browser.version(), runs: RUNS, sizes: [] };
try {
  for (const mib of sizes) {
    const file = path.join(dataDir, fileName(mib));
    const entry = { mib, bytes: statSync(file).size, render: [], edit: [] };
    results.sizes.push(entry);
    console.log(`bench: ${mib} MiB`);
    for (let run = 0; run < RUNS; run++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await page.goto(origin);
        await page.locator('.jse-tree-mode').waitFor();
        const lastId = await page.evaluate(
          async (url) => {
            window.benchText = await (await fetch(url)).text();
            const tail = window.benchText.slice(window.benchText.lastIndexOf('"id": '));
            return Number(/"id": (\d+)/.exec(tail)[1]);
          },
          `/bench-data/${fileName(mib)}`,
        );
        try {
          entry.render.push({ ms: await timeRender(page, `${lastId + 1} items`) });
        } catch (error) {
          entry.render.push({ error: String(error.message ?? error) });
          continue;
        }
        try {
          entry.edit.push(await timeEdit(page, run));
        } catch (error) {
          entry.edit.push({ error: String(error.message ?? error) });
        }
      } finally {
        await page.close();
      }
    }
    console.log(`bench: ${JSON.stringify(entry)}`);
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
console.log(`bench: wrote ${out}`);
