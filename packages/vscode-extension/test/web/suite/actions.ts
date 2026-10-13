// Web e2e (013 T4, spec 013 criteria 3, 4 and 7): spec 003's whole-document actions in the
// library's UI, "Repair JSON", and "Open in CHR JSON Editor" / "Reopen as Text", on the virtual
// scheme, as test/e2e/actions.cjs and suite.cjs check them on desktop. Each case works on a copy
// under work/.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  copyToCase,
  deepEqual,
  equal,
  expectOnly,
  fixture,
  FORMATS,
  isCustom,
  isText,
  match,
  openCustom,
  probeUntil,
  readText,
  sleep,
  tabsFor,
  view,
  waitFor,
  writeToCase,
} from './util';
import type { TestHooks } from '../../../src/extension';
import type { DomStep } from '../../../src/testProbe';

const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const REOPEN_AS_TEXT_COMMAND = 'chrJsonEditor.reopenAsText';
const REPAIR_COMMAND = 'chrJsonEditor.repairJson';

function sortSteps(mode: string): DomStep[] {
  return [
    { click: `.jse-${mode}-mode .jse-sort` },
    { click: '.jse-modal button.jse-primary', text: 'Sort' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

function transformSteps(mode: string, query: string, language?: string): DomStep[] {
  return [
    { click: `.jse-${mode}-mode .jse-transform` },
    ...(language
      ? [{ click: '.jse-modal .jse-config' }, { click: '.jse-query-language', text: language }]
      : []),
    { fill: '.jse-modal textarea.jse-query', value: query },
    { click: '.jse-modal button.jse-primary', text: 'Transform' },
    { waitFor: '.jse-modal', gone: true },
  ];
}

/** The steps that run each spec 003 criterion 5 feature in the library's UI (actions.cjs). */
const FEATURES: Record<string, { mode: 'tree' | 'text'; steps: DomStep[] }> = {
  format: { mode: 'text', steps: [{ click: '.jse-text-mode .jse-format' }] },
  compact: { mode: 'text', steps: [{ click: '.jse-text-mode .jse-compact' }] },
  sort: { mode: 'tree', steps: sortSteps('tree') },
  'search-replace': {
    mode: 'tree',
    steps: [
      { click: '.jse-tree-mode .jse-search' },
      { click: '.jse-replace-toggle' },
      { fill: '.jse-search-input', value: 'draft' },
      { fill: '.jse-replace-input', value: 'final' },
      { waitFor: '.jse-search-count.jse-visible' },
      { click: 'button[title="Replace all occurrences"]' },
    ],
  },
  repair: { mode: 'tree', steps: [{ click: '.jse-tree-mode button', text: 'Ok' }] },
  'transform-jsonquery': { mode: 'tree', steps: transformSteps('tree', 'filter(.age > 30)') },
  'transform-jmespath': {
    mode: 'tree',
    steps: transformSteps('tree', '[?age > `30`]', 'JMESPath'),
  },
  'transform-jsonpath': {
    mode: 'tree',
    steps: transformSteps('tree', '$[?(@.age > 30)]', 'JSONPath (Goessner)'),
  },
};

/** Runs `steps` in the editor of `uri` and waits for the document to change. */
async function act(hooks: TestHooks, document: vscode.TextDocument, steps: DomStep[]) {
  const before = document.getText();
  await hooks.dom(document.uri.toString(), steps);
  await waitFor('the action to change the document', () => document.getText() !== before);
  await probeUntil(
    hooks,
    document.uri,
    'the result to show',
    (p) => p.notice === '' && !!p.content,
  );
}

describe('document actions on the virtual scheme (spec 013 criteria 4 and 7)', () => {
  it('switches tree → text → table → tree without writing to the document', async () => {
    const hooks = await activateHooks();
    for (const format of FORMATS) {
      const uri = await copyToCase('modes', fixture('fixtures', 'open', `sample.${format}`));
      const document = await openCustom(hooks, uri);
      const bytes = await readText(uri);
      for (const mode of ['text', 'table', 'tree'] as const) {
        equal(hooks.setMode(uri.toString(), mode), true, 'setMode');
        await probeUntil(hooks, uri, `${mode} mode`, (p) => p.mode === mode);
      }
      await sleep(500);
      equal(document.getText(), bytes, `sample.${format}: switching modes changed the document`);
      equal(document.isDirty, false, `sample.${format}: dirty`);
      equal(view(hooks, uri).editsReceived, 0, `sample.${format}: edits sent`);
      await closeAll();
    }
  });

  it('runs format, compact, sort, search/replace, repair and transform byte for byte', async () => {
    const hooks = await activateHooks();
    for (const [feature, { mode, steps }] of Object.entries(FEATURES)) {
      const dir = fixture('fixtures', feature);
      const uri = await copyToCase(feature, vscode.Uri.joinPath(dir, 'input.json'));
      const expected = await readText(vscode.Uri.joinPath(dir, 'expected.json'));
      const document = await openCustom(hooks, uri, mode);
      await act(hooks, document, steps);
      equal(document.getText(), expected, `${feature}: not expected.json`);
      deepEqual((await hooks.probe(uri.toString())).violations, [], `${feature}: CSP violations`);
      await document.save();
      equal(await readText(uri), expected, `${feature}: saved bytes`);
      await closeAll();
      console.log(`web: ${feature} writes expected.json byte for byte`);
    }
  });

  it('Repair JSON repairs in the text editor, asking before removing a comment', async () => {
    const hooks = await activateHooks();
    try {
      const lossy = '{\n  "a": "x" + // between\n    "y",\n  "b": 1 // kept\n}\n';
      const uri = await writeToCase('repair', 'broken.jsonc', lossy);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      hooks.confirm(false);
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      let asked = hooks.confirm(true);
      equal(asked.length, 1, 'the lossy repair did not ask');
      match(asked[0], /\/\/ between/, 'question');
      equal(document.getText(), lossy, 'declining the repair changed the document');
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      asked = hooks.confirm(undefined);
      equal(asked.length, 1, 'questions');
      equal(document.getText(), '{\n  "a": "xy",\n  "b": 1 // kept\n}\n', 'repaired');
      await vscode.commands.executeCommand('undo');
      await waitFor('one undo', () => document.getText() === lossy);
      await closeAll();

      // spec 003's repair fixture, as in the desktop e2e.
      const copy = await copyToCase('repair', fixture('fixtures', 'repair', 'input.json'));
      const broken = await vscode.workspace.openTextDocument(copy);
      await vscode.window.showTextDocument(broken);
      await vscode.commands.executeCommand(REPAIR_COMMAND);
      equal(
        broken.getText(),
        await readText(fixture('fixtures', 'repair', 'expected.json')),
        'repair/expected.json',
      );
      await broken.save();
      equal(await readText(copy), broken.getText(), 'saved bytes');
      await closeAll();
    } finally {
      hooks.confirm(undefined);
    }
  });

  it('Open in CHR JSON Editor and Reopen as Text swap the active editor in place', async () => {
    await activateHooks();
    for (const format of FORMATS) {
      await closeAll();
      const uri = fixture('fixtures', 'open', `sample.${format}`);
      await vscode.window.showTextDocument(uri);
      await expectOnly(uri, 'text', isText);
      // With no argument (palette) and with a URI (editor title and explorer menus).
      await vscode.commands.executeCommand(OPEN_COMMAND);
      await expectOnly(uri, 'custom', isCustom);
      await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND);
      await expectOnly(uri, 'text', isText);
      await vscode.commands.executeCommand(OPEN_COMMAND, uri);
      await expectOnly(uri, 'custom', isCustom);
      await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND, uri);
      await expectOnly(uri, 'text', isText);
    }
    // Priority "option": a plain open still uses the text editor.
    await closeAll();
    const json = fixture('fixtures', 'open', 'sample.json');
    await vscode.commands.executeCommand('vscode.open', json);
    await expectOnly(json, 'text', isText);
    equal(tabsFor(json).length, 1, 'tabs');
    await closeAll();
  });
});
