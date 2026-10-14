// Web e2e, spec 013 criterion 8 (013 T4): right after the suite's first activation, the command
// palette of the browser page lists no desktop-only command. The extension API cannot read the
// palette, so on the CI route the suite asks run.mjs, which drives the page with Playwright: it
// opens the palette, types the filter, and writes the commands listed into the mounted folder,
// which the suite fetches from the test server. The local route has no browser page to drive (test/web/README.md);
// there the test checks the command is registered and hidden by its own `when` clause only.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  deepEqual,
  EXTENSION_ID,
  fixture,
  inBrowser,
  manifest,
  ok,
  openText,
  sleep,
} from './util';

/** run.mjs's PALETTE_REQUEST and PALETTE_ANSWER. */
const PALETTE_REQUEST = '[chr-web-e2e] palette ';
const paletteAnswer = (n: number) => `chr-web-e2e-palette-${n}.json`;
let requests = 0;

/** The command palette's rows (their aria labels) for `filter`, read through the browser page. */
async function palette(filter: string): Promise<string[]> {
  const n = ++requests;
  console.log(`${PALETTE_REQUEST}${n} ${filter}`);
  // The answer is a file run.mjs writes into the mounted folder; the folder's listing is cached by
  // the test file system, so it is fetched from the test server, which serves the folder.
  const server = vscode.extensions.getExtension(EXTENSION_ID)!.extensionUri;
  const url = `${server.scheme}://${server.authority}/static/mount/${paletteAnswer(n)}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) {
      const answer = (await response.json()) as { labels?: string[]; error?: string };
      if (answer.error) throw new Error(`the palette check failed: ${answer.error}`);
      return answer.labels ?? [];
    }
    if (Date.now() > deadline) throw new Error(`no palette answer for "${filter}"`);
    await sleep(250);
  }
}

describe('command palette in the browser (spec 013 criterion 8)', () => {
  it('lists no desktop-only command right after the first activation', async () => {
    await activateHooks();
    // A .json file in the text editor: "Compare With…" applies to it, "Compare with HEAD" would on
    // desktop.
    await openText(fixture('fixtures', 'open', 'sample.json'));
    const entry = manifest().contributes.menus.commandPalette?.find(
      (m) => m.command === 'chrJsonEditor.compareWithHead',
    );
    ok(entry?.when?.includes('!isWeb && !chrJsonEditor.webHost'), 'Compare with HEAD: when');
    if (!inBrowser()) {
      console.log('palette: the local route has no browser page; checked on the CI route');
      await closeAll();
      return;
    }
    const labels = await palette('CHR JSON Editor: Compare');
    console.log(`palette: ${JSON.stringify(labels)}`);
    // The control: the palette is read, and lists the command that applies.
    ok(
      labels.some((label) => label.includes('CHR JSON Editor: Compare With…')),
      `the palette does not list "Compare With…": ${JSON.stringify(labels)}`,
    );
    deepEqual(
      labels.filter((label) => label.includes('Compare with HEAD')),
      [],
      'desktop-only commands in the palette',
    );
    await closeAll();
  });
});
