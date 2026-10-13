// Web e2e (013 T5, spec 013 criterion 10): large-file mode and the ceiling in the web host, as
// test/e2e/largeFile.cjs and ceiling.cjs check them on desktop. run.mjs writes the files into
// `large/` (ASCII JSON of exactly these sizes): spec 008's threshold, 5,242,880 bytes, and one
// byte more; the web ceiling UNK-054 records (bench/web-ceiling.md: VS Code's ceiling, 52,428,800
// bytes, as on desktop), and one byte more.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import type { TestHooks } from '../../../src/extension';
import {
  activateHooks,
  closeAll,
  deepEqual,
  equal,
  fixture,
  isCustom,
  size,
  tabsFor,
  view,
  waitFor,
} from './util';

const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const MIB = 1024 * 1024;
export const THRESHOLD = 5 * MIB;
/** UNK-054's web ceiling: VS Code's sync limit, unchanged from spec 008 criterion 9. */
export const WEB_CEILING = 50 * MIB;
/** The files run.mjs writes under `large/`, by size in bytes. */
export const LARGE_FILES = [THRESHOLD, THRESHOLD + 1, WEB_CEILING, WEB_CEILING + 1];
export const largeName = (bytes: number) => `${bytes}.json`;

const lockedBanner = (mib: string) => `Large file (${mib} MiB): read-only to stay fast.`;
const ceilingMessage = (name: string, mib: string) =>
  `${name} is ${mib} MiB. VS Code does not pass files above 50 MB to extensions, ` +
  `so CHR JSON Editor can't open it.`;

/** "Open in CHR JSON Editor" on `uri`, waiting until its webview script runs. */
async function openWithCommand(hooks: TestHooks, uri: vscode.Uri) {
  await closeAll();
  await vscode.commands.executeCommand(OPEN_COMMAND, uri);
  await waitFor(
    `${uri.path} to show only in the custom editor`,
    () => {
      const tabs = tabsFor(uri);
      return tabs.length === 1 && isCustom(tabs[0]);
    },
    60_000,
  );
  await waitFor(
    `the ${uri.path} webview script to run`,
    () => hooks.webviews().some((w) => w.uri === uri.toString() && w.scriptLoaded),
    90_000,
  );
}

/** The banner's text once the page shows it (the `dom` hook waits 5 s per call: ask again). */
async function banner(hooks: TestHooks, uri: vscode.Uri): Promise<string> {
  const read = await waitFor(
    'the large-file banner',
    () =>
      hooks.dom(uri.toString(), [{ read: '.banner span' }]).then(
        ([text]) => text,
        () => null,
      ),
    60_000,
  );
  return read.replace(/\s+/g, ' ').trim();
}

describe('large files in the web host (spec 013 criterion 10)', function () {
  this.timeout(240_000);

  before(async () => {
    for (const bytes of LARGE_FILES) {
      equal(await size(fixture('large', largeName(bytes))), bytes, `large/${largeName(bytes)}`);
    }
  });

  after(async () => {
    (await activateHooks()).ceiling(undefined);
    await closeAll();
  });

  it('a document of 5,242,880 bytes opens normally and one of 5,242,881 in large-file mode', async () => {
    const hooks = await activateHooks();
    hooks.ceiling(false);
    const at = fixture('large', largeName(THRESHOLD));
    await openWithCommand(hooks, at);
    equal(view(hooks, at).largeFile, null, 'at the threshold: large-file mode');
    await hooks.dom(at.toString(), [{ waitFor: '.toolbar' }, { waitFor: '.banner', gone: true }]);

    const over = fixture('large', largeName(THRESHOLD + 1));
    await openWithCommand(hooks, over);
    deepEqual(
      view(hooks, over).largeFile,
      { bytes: THRESHOLD + 1, unlocked: false },
      'one byte over: large-file mode',
    );
    equal(await banner(hooks, over), lockedBanner('5.0'), 'one byte over: banner');
    deepEqual(hooks.ceiling(false), [], 'ceiling messages');
  });

  it("the web ceiling (UNK-054) opens in large-file mode, and one byte more shows spec 008's message", async () => {
    const hooks = await activateHooks();
    hooks.ceiling(false);
    const at = fixture('large', largeName(WEB_CEILING));
    await openWithCommand(hooks, at);
    deepEqual(
      view(hooks, at).largeFile,
      { bytes: WEB_CEILING, unlocked: false },
      'at the ceiling: large-file mode',
    );
    equal(await banner(hooks, at), lockedBanner('50.0'), 'at the ceiling: banner');
    deepEqual(hooks.ceiling(false), [], 'at the ceiling: no message');

    await closeAll();
    const over = fixture('large', largeName(WEB_CEILING + 1));
    await vscode.commands.executeCommand(OPEN_COMMAND, over);
    deepEqual(
      hooks.ceiling(false),
      [ceilingMessage(largeName(WEB_CEILING + 1), '50.0')],
      'one byte over the ceiling: the message',
    );
    equal(tabsFor(over).length, 0, 'one byte over the ceiling: an editor opened');
  });
});
