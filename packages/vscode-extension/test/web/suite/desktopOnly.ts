// Web e2e, spec 013 criterion 8 (013 T2, UNK-053 ★): run by id in the web host, a desktop-only
// command shows "<title> is available in VS Code desktop." and does nothing else. Its menu entries
// are checked in test/unit/desktopOnly.test.ts, and the palette through the browser page in
// palette.ts (the extension API cannot read the palette).
/// <reference types="mocha" />
import * as vscode from 'vscode';
import { activateHooks, closeAll, equal, fixture } from './util';

describe('desktop-only commands in the web host (spec 013 criterion 8)', () => {
  it('Compare with HEAD says it is available in VS Code desktop and does nothing else', async () => {
    const hooks = await activateHooks();
    const uri = fixture('fixtures', 'open', 'sample.json');
    await vscode.window.showTextDocument(uri);
    const text = vscode.window.activeTextEditor?.document.getText();
    const comparesBefore = hooks.compares().length;
    hooks.comparePick(undefined); // clears earlier messages

    // Both with the active editor and with a URI, as the explorer and editor title menus pass.
    await vscode.commands.executeCommand('chrJsonEditor.compareWithHead');
    await vscode.commands.executeCommand('chrJsonEditor.compareWithHead', uri);

    const message = 'Compare with HEAD is available in VS Code desktop.';
    equal(
      JSON.stringify(hooks.comparePick(undefined)),
      JSON.stringify([message, message]),
      'messages shown',
    );
    equal(hooks.compares().length, comparesBefore, 'compare panels opened');
    equal(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString(), 'active editor');
    equal(vscode.window.activeTextEditor?.document.getText(), text, 'document text');
    equal(vscode.window.activeTextEditor?.document.isDirty, false, 'document dirty');
    equal(
      vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'chr-json-head').length,
      0,
      'HEAD documents opened',
    );
    await closeAll();
  });
});
