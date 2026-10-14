// UNK-054's measurement (spec 013 T5), run by `run.mjs --ceiling` on the CI route instead of the
// suite, three times per bench run (bench/web-ceiling.mjs): the largest document that opens in the
// web host. The workspace holds the bench generator's JSON documents under `ceiling/`, listed in
// `ceiling/cases.json` (smallest first). For each one, "Open in CHR JSON Editor" runs on it and
// this records whether the command refused it (the ceiling message), how long the tab took to show
// spec 008's banner and the tree with every record, and whether the webview still answers a few
// seconds later. Before that, `openTextDocument` on the largest two files measures VS Code's sync
// limit in the web host (008 T4 measured desktop's). Each result is one console line starting with
// RESULT, which run.mjs writes to the results file; nothing here fails a test, a missing line is
// the failure (a worker that crashed logs nothing more).
import * as vscode from 'vscode';
import { activateHooks, closeAll, fixture, readText, sleep, waitFor } from './util';

const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
export const RESULT = '[chr-web-ceiling] ';
/** How long one open may take before it is recorded as not opened (UNK-054 counts 30 s). */
const OPEN_TIMEOUT_MS = 120_000;
/** How long after the banner the webview must still answer (UNK-054: "neither crashes"). */
const ALIVE_AFTER_MS = 5_000;

interface Case {
  name: string;
  bytes: number;
  records: number;
}

const log = (result: object) => console.log(RESULT + JSON.stringify(result));

/** Rejects after `ms` with `what`, so one stuck step records a result instead of hanging. */
function within<T>(what: string, promise: Thenable<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${what}`)), ms),
    ),
  ]);
}

async function syncLimit(cases: Case[]): Promise<void> {
  for (const { name, bytes } of cases.slice(-2)) {
    const uri = fixture('ceiling', name);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      log({ kind: 'sync', name, bytes, opens: true, length: document.getText().length });
    } catch (error) {
      log({ kind: 'sync', name, bytes, opens: false, error: String(error) });
    }
  }
}

async function open(hooks: Awaited<ReturnType<typeof activateHooks>>, entry: Case) {
  const uri = fixture('ceiling', entry.name);
  const key = uri.toString();
  const result: Record<string, unknown> = { kind: 'open', name: entry.name, bytes: entry.bytes };
  await closeAll();
  hooks.ceiling(false);
  const start = Date.now();
  try {
    await within('the open command', vscode.commands.executeCommand(OPEN_COMMAND, uri), 60_000);
    const refused = hooks.ceiling(false);
    if (refused.length) {
      result.refused = refused;
      return result;
    }
    const deadline = start + OPEN_TIMEOUT_MS;
    const left = () => Math.max(1, deadline - Date.now());
    const view = await waitFor(
      `the ${entry.name} webview script to run`,
      () => hooks.webviews().find((w) => w.uri === key && w.scriptLoaded),
      left(),
    );
    result.readyMs = Date.now() - start;
    result.largeFile = view.largeFile;
    // The `dom` hook waits five seconds for an element: ask again until the deadline.
    const banner = await waitFor(
      'the banner',
      () =>
        within('the banner', hooks.dom(key, [{ read: '.banner span' }]), left()).then(
          ([read]) => read,
          (error: unknown) => {
            if (Date.now() >= deadline) throw error;
            return null;
          },
        ),
      left(),
    );
    result.banner = banner.replace(/\s+/g, ' ').trim();
    result.bannerMs = Date.now() - start;
    await within('the tree', hooks.whenShown(key, `${entry.records} items`), left());
    result.renderMs = Date.now() - start;
    await sleep(ALIVE_AFTER_MS);
    const [again] = await within(
      'the webview to answer',
      hooks.dom(key, [{ read: '.banner span' }]),
      10_000,
    );
    result.alive = again !== null;
    result.webviewHeap = await within('the webview heap', hooks.webviewHeap(key), 10_000).catch(
      () => null,
    );
  } catch (error) {
    result.error = String(error);
    result.elapsedMs = Date.now() - start;
  }
  return result;
}

export async function run(): Promise<void> {
  const hooks = await activateHooks();
  const cases = JSON.parse(await readText(fixture('ceiling', 'cases.json'))) as Case[];
  log({ kind: 'start', userAgent: navigator.userAgent, cases: cases.map((c) => c.name) });
  await syncLimit(cases);
  for (const entry of cases) {
    log(await open(hooks, entry));
    await closeAll().catch(() => undefined);
  }
  log({ kind: 'end' });
}
