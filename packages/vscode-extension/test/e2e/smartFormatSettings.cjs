// Gate for 019 T4 (spec 019 criterion 5, e2e part), run by suite.cjs inside VS Code. With
// `"[jsonc]": {"chrJsonEditor.smartFormat.maxLineLength": 60}`, "Smart Format" on the input of the
// golden case tests/golden/smart-format/jsonc/max-line-length-60 leaves the document byte-equal to
// its expected file: from the command in the text editor, and from the Smart Format button of a CHR
// JSON Editor tab in text mode (the webview's action). The value is written as a user setting
// (ConfigurationTarget.Global, overrideInLanguage), as settings.cjs does: the desktop e2e opens no
// workspace folder. A `.json` copy of the same text, outside the `[jsonc]` block, is laid out at the
// default 120 columns, so it does not come out as the 60-column text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const VIEW_TYPE = 'chrJsonEditor.editor';
const COMMAND = 'chrJsonEditor.smartFormat';
const KEY = 'smartFormat.maxLineLength';
const CASE = path.resolve(
  __dirname,
  '../../../../tests/golden/smart-format/jsonc/max-line-length-60',
);

exports.runSmartFormatSettings = async function runSmartFormatSettings({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'smart-format-settings-'));
  const input = fs.readFileSync(path.join(CASE, 'input.jsonc'), 'utf8');
  const expected = fs.readFileSync(path.join(CASE, 'expected.jsonc'), 'utf8');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(CASE, 'options.json'), 'utf8')), {
    maxLineLength: 60,
  });
  const isText = (tab) => tab.input instanceof vscode.TabInputText;
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  /** Writes `chrJsonEditor.smartFormat.maxLineLength` for jsonc to the user settings and waits
   *  until the extension host reads it back. */
  async function set(value) {
    const scope = { languageId: 'jsonc' };
    await vscode.workspace
      .getConfiguration('chrJsonEditor', scope)
      .update(KEY, value, vscode.ConfigurationTarget.Global, true);
    await waitFor(
      `[jsonc] chrJsonEditor.${KEY} = ${JSON.stringify(value)}`,
      () =>
        vscode.workspace.getConfiguration('chrJsonEditor', scope).inspect(KEY)
          .globalLanguageValue === value,
    );
  }

  async function probeUntil(uri, what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(probe)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Writes the case's input as `name` and opens it in the text editor or, with `custom`, in a
   *  CHR JSON Editor tab in text mode. */
  async function open(name, custom) {
    const file = path.join(fs.mkdtempSync(path.join(dir, 'case-')), name);
    fs.writeFileSync(file, input);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    if (custom) {
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await expectOnly(uri, 'custom', isCustom);
      await waitFor(`the webview of ${name}`, () => view(uri)?.scriptLoaded === true, 60000);
      await probeUntil(uri, 'the document in the editor', (p) => p.mode !== null && !!p.content);
      assert.equal(hooks.setMode(uri.toString(), 'text'), true);
      await probeUntil(uri, 'text mode', (p) => p.mode === 'text');
    } else {
      await vscode.window.showTextDocument(document);
      await expectOnly(uri, 'text', isText);
    }
    return { uri, document };
  }

  await closeAll();
  await set(60);
  try {
    // The command, in the text editor.
    {
      const { document } = await open('wide.jsonc');
      assert.equal(document.languageId, 'jsonc');
      await vscode.commands.executeCommand(COMMAND);
      await waitFor('the 60-column text (command)', () => document.getText() === expected);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await closeAll();
    }

    // The webview's Smart Format button, in a CHR JSON Editor tab in text mode.
    {
      const { uri, document } = await open('wide.jsonc', true);
      await hooks.dom(uri.toString(), [{ click: '.jse-text-mode .chr-smart-format' }]);
      await waitFor('the 60-column text (button)', () => document.getText() === expected);
      const probe = await hooks.probe(uri.toString());
      assert.deepEqual(probe.violations, [], 'the action broke the CSP');
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await closeAll();
    }

    // A .json document is outside the [jsonc] block: the default line length lays it out.
    {
      const { document } = await open('wide.json');
      assert.equal(document.languageId, 'json');
      const version = document.version;
      await vscode.commands.executeCommand(COMMAND);
      await waitFor('the .json copy, smart-formatted', () => document.version > version);
      assert.notEqual(document.getText(), expected, '[jsonc] value used for a .json document');
      const longest = Math.max(
        ...document
          .getText()
          .split('\n')
          .map((line) => line.length),
      );
      assert.ok(
        longest > 60,
        `the .json copy was laid out at 60 columns (longest line ${longest})`,
      );
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await closeAll();
    }
    console.log(
      'criterion 5: [jsonc] maxLineLength 60 lays out the golden 60-column case byte for byte (command and button); .json keeps 120',
    );
  } finally {
    await set(undefined);
    await closeAll();
  }
};
