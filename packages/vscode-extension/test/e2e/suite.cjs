// Runs inside VS Code (loaded through --extensionTestsPath by run.mjs). Rejecting fails test:e2e.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'christian-vrl.chr-json-editor';
const NOOP_COMMAND = 'chrJsonEditor.noop';

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

  // Invoking the contributed command activates the extension, whose activate() registers it.
  await vscode.commands.executeCommand(NOOP_COMMAND);
  assert.equal(extension.isActive, true, `${EXTENSION_ID} did not activate`);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(NOOP_COMMAND), `${NOOP_COMMAND} is not registered`);

  console.log(
    `${EXTENSION_ID} ${extension.packageJSON.version} is active from ${extension.extensionPath}`,
  );
};
