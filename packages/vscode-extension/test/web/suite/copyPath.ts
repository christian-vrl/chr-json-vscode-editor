// Web e2e (018 T3; spec 013 criterion 7's coverage map): the copy path and reveal commands run in
// the web worker extension host on the virtual file system, on fixtures/copy-path/sample.json as
// test/e2e/copyPath.cjs runs them on desktop (spec 018 criteria 7 and 8). Criterion 12's full set
// of web cases is 018 T5's.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import {
  activateHooks,
  closeAll,
  equal,
  expectOnly,
  fixture,
  ok,
  openCustom,
  openText,
  probeUntil,
  waitFor,
} from './util';

const SAMPLE = () => fixture('fixtures', 'copy-path', 'sample.json');
const SENTINEL = 'chr-copy-path: nothing copied';

async function copied(command: string): Promise<string> {
  await vscode.env.clipboard.writeText(SENTINEL);
  await vscode.commands.executeCommand(command);
  return vscode.env.clipboard.readText();
}

describe('copy path and reveal node (spec 018)', () => {
  it('Copy JSONPath, Copy JSON Pointer and both reveals show the node in either editor', async () => {
    const hooks = await activateHooks();
    await closeAll();
    const uri = SAMPLE();

    // The text editor: the node at the cursor.
    const document = await openText(uri);
    const { version } = document;
    const editor = vscode.window.activeTextEditor!;
    const at = document.positionAt(document.getText().indexOf('"Bob"'));
    editor.selection = new vscode.Selection(at, at);
    equal(await copied('chrJsonEditor.copyJsonPath'), '$.people[1].name', 'text: Copy JSONPath');
    equal(
      await copied('chrJsonEditor.copyJsonPointer'),
      '/people/1/name',
      'text: Copy JSON Pointer',
    );

    // "Reveal in CHR JSON Editor": the text tab is replaced, the node selected.
    await vscode.commands.executeCommand('chrJsonEditor.revealInEditor');
    await expectOnly(uri, 'custom');
    await waitFor('the revealed node selected', async () => {
      const [path] = await hooks
        .dom(uri.toString(), [
          { read: '.jse-tree-mode .jse-json-node[class*="jse-selected"]', attr: 'data-path' },
        ])
        .catch(() => [null]);
      return path !== null && decodeURIComponent(path) === '/people/1/name';
    });

    // The CHR JSON Editor: the selected node.
    await closeAll();
    await openCustom(hooks, uri);
    ok(hooks.select(uri.toString(), '/a~1b/m~0n'), 'select');
    equal(await copied('chrJsonEditor.copyJsonPath'), "$['a/b']['m~n']", 'tree: Copy JSONPath');
    equal(await copied('chrJsonEditor.copyJsonPointer'), '/a~1b/m~0n', 'tree: Copy JSON Pointer');
    await probeUntil(hooks, uri, 'the editor', (p) => p.mode === 'tree');

    // "Reveal in Text Editor": the CHR JSON Editor tab is replaced, the cursor at the place.
    await vscode.commands.executeCommand('chrJsonEditor.revealInText');
    await expectOnly(uri, 'text');
    const text = vscode.window.activeTextEditor!;
    equal(
      text.document.offsetAt(text.selection.active),
      document.getText().indexOf('"m~n"'),
      'the cursor at the place',
    );
    equal(document.version, version, 'the version');
    equal(document.isDirty, false, 'dirty');
    await closeAll();
  });
});
