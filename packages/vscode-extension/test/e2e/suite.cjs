// Runs inside VS Code (loaded through --extensionTestsPath by run.mjs). Rejecting fails test:e2e.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const VIEW_TYPE = 'chrJsonEditor.editor';
const OPEN_COMMAND = 'chrJsonEditor.openInEditor';
const REOPEN_AS_TEXT_COMMAND = 'chrJsonEditor.reopenAsText';
const FIXTURES = path.resolve(__dirname, '../../../../tests/e2e/fixtures/open');
const FORMATS = ['json', 'jsonc', 'json5'];

function fixture(format) {
  return vscode.Uri.file(path.join(FIXTURES, `sample.${format}`));
}

function tabsFor(uri) {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input && tab.input.uri && tab.input.uri.toString() === uri.toString());
}

function isCustom(tab) {
  return tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE;
}

function isText(tab) {
  return tab.input instanceof vscode.TabInputText;
}

function describe(tab) {
  return tab ? `${tab.input?.constructor?.name} ${tab.input?.viewType ?? ''}`.trim() : 'no tab';
}

// Editor switches settle asynchronously; poll the tab model instead of sleeping a fixed time.
async function waitFor(what, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function activeTab() {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

async function closeAll() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () =>
    vscode.window.tabGroups.all.every((g) => !g.tabs.length),
  );
}

async function expectOnly(uri, kind, check) {
  await waitFor(`${path.basename(uri.fsPath)} to show only in the ${kind} editor`, () => {
    const tabs = tabsFor(uri);
    return tabs.length === 1 && check(tabs[0]) && activeTab() === tabs[0];
  });
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not installed`);

  // Installed from the .vsix into the fresh profile, not loaded from the source tree.
  const extensionsDir = process.env.CHR_E2E_EXTENSIONS_DIR;
  assert.ok(extensionsDir, 'CHR_E2E_EXTENSIONS_DIR is not set');
  const relative = path.relative(extensionsDir, extension.extensionPath);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${EXTENSION_ID} loaded from ${extension.extensionPath}, outside ${extensionsDir}`,
  );

  // UNK-004: "Open With" only, so the manifest offers the editor at priority "option".
  const editors = extension.packageJSON.contributes?.customEditors ?? [];
  const editor = editors.find((e) => e.viewType === VIEW_TYPE);
  assert.ok(editor, `${VIEW_TYPE} is not contributed`);
  assert.equal(editor.priority, 'option');
  assert.deepEqual(
    editor.selector.map((s) => s.filenamePattern),
    FORMATS.map((f) => `*.${f}`),
  );
  const titles = Object.fromEntries(
    (extension.packageJSON.contributes?.commands ?? []).map((c) => [c.command, c.title]),
  );
  assert.equal(titles[OPEN_COMMAND], 'Open in CHR JSON Editor');
  assert.equal(titles[REOPEN_AS_TEXT_COMMAND], 'Reopen as Text');

  // Gate (003 T3): one fixture per format opens in the custom editor.
  for (const format of FORMATS) {
    await closeAll();
    const uri = fixture(format);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    console.log(`sample.${format}: ${describe(activeTab())}`);
  }
  assert.equal(extension.isActive, true, `${EXTENSION_ID} did not activate`);

  // Priority "option": a plain open still uses the text editor.
  await closeAll();
  await vscode.commands.executeCommand('vscode.open', fixture('json'));
  await expectOnly(fixture('json'), 'text', isText);

  // The two commands swap the active editor in place, with no argument (palette) and with a URI
  // (editor title and explorer menus).
  for (const format of FORMATS) {
    await closeAll();
    const uri = fixture(format);
    await vscode.window.showTextDocument(uri);
    await expectOnly(uri, 'text', isText);
    await vscode.commands.executeCommand(OPEN_COMMAND);
    await expectOnly(uri, 'custom', isCustom);
    await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND);
    await expectOnly(uri, 'text', isText);
    await vscode.commands.executeCommand(OPEN_COMMAND, uri);
    await expectOnly(uri, 'custom', isCustom);
    await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND, uri);
    await expectOnly(uri, 'text', isText);
    console.log(`sample.${format}: commands switch text <-> custom`);
  }

  // Opening from the explorer with nothing open lands in the custom editor too.
  await closeAll();
  await vscode.commands.executeCommand(OPEN_COMMAND, fixture('json5'));
  await expectOnly(fixture('json5'), 'custom', isCustom);
  await closeAll();

  console.log(
    `${EXTENSION_ID} ${extension.packageJSON.version} is active from ${extension.extensionPath}`,
  );
};
