// Web e2e, spec 019 T1 (criterion 10's command part, C1): "CHR JSON Editor: Open Settings" opens
// VS Code's Settings editor on the extension's settings in the web extension host too. The search
// box is part of the workbench, out of the extension API's reach, so the test reads the search the
// command passed (a test hook) and that the active tab is the Settings editor.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import { activateHooks, activeTab, closeAll, deepEqual, waitFor } from './util';

describe('settings (spec 019)', () => {
  it('Open Settings opens the Settings editor on the extension’s settings', async () => {
    const hooks = await activateHooks();
    await closeAll();
    hooks.openSettingsQueries();
    await vscode.commands.executeCommand('chrJsonEditor.openSettings');
    await waitFor('the Settings editor', () => activeTab()?.label === 'Settings');
    deepEqual(
      hooks.openSettingsQueries(),
      ['@ext:christian-vrl.chr-json-editor'],
      'the Settings editor’s search',
    );
    await closeAll();
  });
});
