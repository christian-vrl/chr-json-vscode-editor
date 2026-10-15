// Web e2e, spec 019 criterion 10 (T1: the command; T6: the settings), in the web extension host.
// - C1: "CHR JSON Editor: Open Settings" opens VS Code's Settings editor on the extension's
//   settings. The search box is part of the workbench, out of the extension API's reach, so the
//   test reads the search the command passed (a test hook) and that the active tab is the Settings
//   editor.
// - M1 and T1 from the workspace (019 T6): the settings are written to the web test workspace's
//   `.vscode/settings.json` (ConfigurationTarget.Workspace; run.mjs's workspace, a mounted folder on
//   the CI route), the route §"Where settings come from on vscode.dev and github.dev" names for a
//   repository's settings. `chrJsonEditor.defaultMode` `"text"` opens a `.json` file in Text mode,
//   and `chrJsonEditor.largeFileThreshold` `1` opens a 2 MiB file in large-file mode, which it does
//   not without the setting. Each case removes its key again, so the other files' cases run with
//   no setting.
/// <reference types="mocha" />
import * as vscode from 'vscode';
import { banner, lockedBanner, openWithCommand } from './largeFile';
import {
  activateHooks,
  activeTab,
  closeAll,
  copyToCase,
  deepEqual,
  equal,
  fixture,
  probeUntil,
  view,
  waitFor,
  writeToCase,
} from './util';

const MIB = 1024 * 1024;

/** Writes `chrJsonEditor.<key>` to the workspace settings (`undefined` removes it) and waits until
 *  the extension host reads it back at the workspace level. */
async function setWorkspace(key: string, value: unknown): Promise<void> {
  await vscode.workspace
    .getConfiguration('chrJsonEditor')
    .update(key, value, vscode.ConfigurationTarget.Workspace);
  await waitFor(`workspace chrJsonEditor.${key} = ${JSON.stringify(value)}`, () => {
    const inspected = vscode.workspace.getConfiguration('chrJsonEditor').inspect(key);
    return inspected?.workspaceValue === value;
  });
}

/** An ASCII JSON array of exactly `bytes` bytes, padded with spaces before the closing bracket (as
 *  run.mjs's `largeJson`). */
function jsonOfSize(bytes: number): string {
  const line = '  {"id": 1, "name": "alpha", "tags": ["a", "b"]},\n';
  const body = `[\n${line.repeat(Math.floor((bytes - 64) / line.length))}  {"id": 2}`;
  return body + ' '.repeat(bytes - body.length - 2) + '\n]';
}

describe('settings (spec 019)', function () {
  this.timeout(240_000);

  after(async () => {
    await setWorkspace('defaultMode', undefined);
    await setWorkspace('largeFileThreshold', undefined);
    await closeAll();
  });

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

  it('a workspace chrJsonEditor.defaultMode of "text" opens a .json file in Text mode', async () => {
    const hooks = await activateHooks();
    await closeAll();
    const uri = await copyToCase('settings-mode', fixture('fixtures', 'open', 'sample.json'));
    await setWorkspace('defaultMode', 'text');
    try {
      await openWithCommand(hooks, uri);
      const probe = await probeUntil(
        hooks,
        uri,
        'Text mode with the document',
        (p) => p.mode === 'text' && !!p.content,
        30_000,
      );
      equal(probe.mode, 'text', 'the mode the tab opened in');
    } finally {
      await setWorkspace('defaultMode', undefined);
      await closeAll();
    }
    // With no setting, a new tab opens in Tree as before.
    await openWithCommand(hooks, uri);
    await probeUntil(hooks, uri, 'Tree mode', (p) => p.mode === 'tree' && !!p.content, 30_000);
    await closeAll();
  });

  it('a workspace chrJsonEditor.largeFileThreshold of 1 opens a 2 MiB file in large-file mode', async () => {
    const hooks = await activateHooks();
    await closeAll();
    const uri = await writeToCase('settings-threshold', 'two-mib.json', jsonOfSize(2 * MIB));
    equal((await vscode.workspace.fs.stat(uri)).size, 2 * MIB, 'two-mib.json: bytes');
    await setWorkspace('largeFileThreshold', 1);
    try {
      await openWithCommand(hooks, uri);
      deepEqual(
        view(hooks, uri).largeFile,
        { bytes: 2 * MIB, unlocked: false },
        'with the setting at 1: large-file mode',
      );
      equal(await banner(hooks, uri), lockedBanner('2.0'), 'with the setting at 1: banner');
    } finally {
      await setWorkspace('largeFileThreshold', undefined);
      await closeAll();
    }
    // With no setting (5 MiB), the same file opens normally.
    await openWithCommand(hooks, uri);
    equal(view(hooks, uri).largeFile, null, 'with no setting: not in large-file mode');
    await closeAll();
  });
});
