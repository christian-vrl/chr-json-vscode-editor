// Web e2e, spec 013 criterion 3 (013 T1 smoke, 013 T4 all three formats): the extension activates
// in the web worker extension host with no error, and "Open With → CHR JSON Editor" on spec 003's
// `.json`, `.jsonc` and `.json5` fixtures shows the document's data in the webview.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  deepEqual,
  equal,
  EXTENSION_ID,
  fixture,
  FORMATS,
  openCustom,
  probeUntil,
} from './util';

const LABELS = { json: 'JSON', jsonc: 'JSONC', json5: 'JSON5' };

describe('web host smoke (spec 013 criterion 3)', () => {
  it('runs in the web worker extension host and activates the extension there', async () => {
    // No Node: the suite and the extension share the worker (plan R2).
    equal(typeof (globalThis as { process?: unknown }).process, 'undefined', 'typeof process');
    // Rejects with the activation error, if any.
    await activateHooks();
    equal(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true, 'the extension is active');
    // Restricted Mode turns the extension off (spec 013 §Where we differ); README.md records it.
    console.log(`web e2e: workspace trusted: ${vscode.workspace.isTrusted}`);
    if (!vscode.workspace.isTrusted)
      throw new Error('the test workspace starts in Restricted Mode');
    console.log(`web e2e: workspace folder ${fixture().toString()}`);
  });

  for (const format of FORMATS) {
    it(`opens sample.${format} in CHR JSON Editor with the document’s data`, async () => {
      const hooks = await activateHooks();
      const uri = fixture('fixtures', 'open', `sample.${format}`);
      await openCustom(hooks, uri);
      // The editor library holds the data as `{ json }` or as `{ text }` (testProbe.ts); text is
      // the document's own text, comments included, so it is compared as it is.
      const probe = await probeUntil(hooks, uri, 'the format label', (p) => p.format !== '');
      const content = probe.content as { text: string } | { json: unknown };
      const document = await vscode.workspace.openTextDocument(uri);
      if ('json' in content) deepEqual(content.json, JSON.parse(document.getText()), 'data');
      else equal(content.text, document.getText(), 'webview text');
      equal(probe.mode, 'tree', 'mode');
      equal(probe.format, LABELS[format], 'format label');
      equal(probe.toolbarMode, 'Tree', 'toolbar mode');
      equal(probe.mainMinHeight, '150px', 'library CSS');
      deepEqual(probe.violations, [], 'CSP violations');
      await closeAll();
    });
  }
});
