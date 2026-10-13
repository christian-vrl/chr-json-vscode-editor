// Web e2e (013 T4, spec 013 plan R6): Transform with JavaScript and with Lodash in the web host, as
// test/e2e/query.cjs checks it on desktop (spec 011 criterion 7): the sealed QuickJS engine loads
// and compiles in the webview under the editor's CSP (served through the webview service worker
// on the CI route), each case in tests/e2e/fixtures/query/ writes its expected text, and one undo
// restores the input. Each case works on a copy under work/.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import type { DomStep } from '../../../src/testProbe';
import {
  activateHooks,
  closeAll,
  copyToCase,
  deepEqual,
  equal,
  fixture,
  list,
  ok,
  openCustom,
  probeUntil,
  readText,
  sleep,
  waitFor,
} from './util';

interface Case {
  language: 'JavaScript' | 'Lodash';
  mode: 'tree' | 'text' | 'table';
  query: string;
  node?: string;
}

function transformSteps({ mode, node, language, query }: Case): DomStep[] {
  const open: DomStep[] = node
    ? [
        { mousedown: '.jse-tree-mode .jse-key', text: node },
        { click: '.jse-tree-mode button.jse-contextmenu' },
        { click: '.jse-contextmenu button', text: 'Transform' },
      ]
    : [{ click: `.jse-${mode}-mode .jse-transform` }];
  return [
    ...open,
    { click: '.jse-modal .jse-config' },
    { click: '.jse-query-language', text: language },
    { fill: '.jse-modal textarea.jse-query', value: query },
    { click: '.jse-modal button.jse-primary', text: 'Transform' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

describe('JavaScript and Lodash queries in the web host (spec 013 plan R6)', () => {
  it('Transform with JavaScript and Lodash writes the expected text, undone in one step', async () => {
    const hooks = await activateHooks();
    const names = await list(fixture('fixtures', 'query'));
    ok(names.length > 0, 'no query cases');
    const covered = new Set<string>();
    for (const name of names) {
      const dir = fixture('fixtures', 'query', name);
      const files = await list(dir);
      const input = files.find((f) => /^input\.(json|jsonc|json5)$/.test(f));
      ok(input, `${name}: no input.{json,jsonc,json5}`);
      const ext = input.slice(input.indexOf('.'));
      const meta = JSON.parse(await readText(vscode.Uri.joinPath(dir, 'case.json'))) as Case;
      covered.add(`${meta.language} ${meta.node ? 'node' : meta.mode}`);
      const expected = await readText(vscode.Uri.joinPath(dir, `expected${ext}`));
      const uri = await copyToCase('query', vscode.Uri.joinPath(dir, input));
      const before = await readText(uri);
      const document = await openCustom(hooks, uri, meta.mode);
      await hooks.dom(uri.toString(), transformSteps(meta));
      await waitFor(
        `${name}: Transform to change the document`,
        () => document.getText() !== before,
      );
      await probeUntil(hooks, uri, `${name}: the result`, (p) => p.notice === '' && !!p.content);
      equal(document.getText(), expected, `${name}: not expected${ext}`);
      equal(document.isDirty, true, `${name}: not dirty`);
      equal(await readText(uri), before, `${name}: the file was saved`);
      deepEqual((await hooks.probe(uri.toString())).violations, [], `${name}: CSP violations`);
      await vscode.commands.executeCommand('undo');
      await waitFor(`${name}: the undo`, () => document.getText() !== expected);
      await sleep(500);
      equal(document.getText(), before, `${name}: one undo did not restore the input`);
      await closeAll();
    }
    for (const language of ['JavaScript', 'Lodash']) {
      for (const where of ['tree', 'text', 'table', 'node']) {
        ok(covered.has(`${language} ${where}`), `no ${language} case in ${where}`);
      }
    }
  });
});
