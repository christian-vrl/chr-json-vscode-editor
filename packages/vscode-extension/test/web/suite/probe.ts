// The expected-failure fixture of spec 013 criterion 11 (013 T4), run by `run.mjs --probe` on the CI
// route instead of the suite: a fetch of https://example.com from the web worker extension host,
// where VS Code's own CSP allows `https:`, must make run.mjs's network check fail; the same fetch
// from the CHR JSON Editor's webview must be refused by its CSP (`connect-src 'none'`). Every test
// here passes: the exit code 1 the CI job expects comes from the network check alone.
/// <reference types="mocha" />
import 'mocha/mocha';
import * as vscode from 'vscode';
import { activateHooks, fixture, openCustom } from './util';

const PROBE_URL = 'https://example.com/';

export async function run(): Promise<void> {
  mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 60_000 });
  describe('network probe (spec 013 criterion 11, expected failure)', () => {
    it('the webview cannot fetch: its CSP refuses the request', async () => {
      const hooks = await activateHooks();
      const uri = fixture('fixtures', 'open', 'sample.json');
      await openCustom(hooks, uri);
      const [read] = await hooks.dom(uri.toString(), [{ fetch: PROBE_URL }]);
      if (!read?.startsWith('blocked '))
        throw new Error(`the webview's fetch was not refused: ${read}`);
      const probe = await hooks.probe(uri.toString());
      if (!probe.violations.some((v) => v.includes('connect-src')))
        throw new Error(`no connect-src violation: ${JSON.stringify(probe.violations)}`);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    it('the worker fetches https://example.com, which the network check must report', async () => {
      // The answer does not matter (CI may reach the site or not): the request is what counts.
      await fetch(PROBE_URL, { mode: 'no-cors' }).catch((error: unknown) => {
        console.log(`probe: the worker's fetch failed: ${String(error)}`);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} probe test(s) failed`)) : resolve(),
    );
  });
}
