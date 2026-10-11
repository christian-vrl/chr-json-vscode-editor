// Gate for 008 T5 (spec 008 criterion 10, UNK-041), run by suite.cjs inside VS Code. Up to UNK-041's
// size a large-file tab validates as spec 004 says; above it validation does not run on open or on
// change, a status-bar item reads "Schema validation paused: large file", and its command validates
// once with core's data-only parse. The limit is set through a test hook on each side of a 6 MiB
// fixture, so the gate does not depend on the measured value; `largeFile.test.ts` checks the value
// itself sits at or above the large-file threshold.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const VALIDATE_ONCE_COMMAND = 'chrJsonEditor.validateOnce';
const PAUSED_TEXT = 'Schema validation paused: large file';
const SIX_MIB = 6 * 1024 * 1024;
/** Long enough for a validation that should not run to have posted: a timer and a round trip. */
const SETTLE_MS = 1000;
const SCHEMA = { type: 'array', maxItems: 1 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.runValidationPaused = async function runValidationPaused({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'validation-paused-'));
  const file = path.join(dir, 'six.json');
  fs.writeFileSync(file, documentText('json', SIX_MIB));
  const uri = vscode.Uri.file(file);
  const key = uri.toString();
  const view = () => hooks.webviews().find((w) => w.uri === key);
  const shown = () => view().validationsShown;

  async function open() {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor('the webview', () => view()?.scriptLoaded, 60000);
    assert.deepEqual(view().largeFile, { bytes: SIX_MIB, unlocked: false });
    return document;
  }

  /** Changes the first marker ("start") from outside the editor, as another extension would; the
   *  value keeps its five characters so the file stays 6 MiB for the next open. */
  async function changeExternally(document, value) {
    const text = document.getText();
    const at = text.indexOf('"marker": "') + '"marker": "'.length;
    const end = text.indexOf('"', at);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(at), document.positionAt(end)), value);
    assert.ok(await vscode.workspace.applyEdit(edit));
  }

  const keywords = (result) => result.errors.map((e) => e.keyword);

  // Up to the limit: validation runs on open (here, when the schema is set) and on change.
  hooks.validationLimit(SIX_MIB);
  await closeAll();
  let document = await open();
  let before = shown().length;
  assert.equal(hooks.setSchema(key, SCHEMA), true);
  await waitFor('the validation result', () => shown().length > before, 30000);
  assert.deepEqual(keywords(shown().at(-1)), ['maxItems']);
  assert.equal(hooks.pausedValidation(), null, 'the paused item shows at the limit');
  before = shown().length;
  await changeExternally(document, 'limit');
  await waitFor('validation after the change', () => shown().length > before, 30000);
  assert.equal(shown().at(-1).docVersion, document.version);
  hooks.setSchema(key, undefined);
  await document.save();
  console.log('criterion 10: up to the limit, a large file validates on open and on change');

  // Above the limit: nothing runs on open or on change; the status-bar item validates once.
  hooks.validationLimit(SIX_MIB - 1);
  await closeAll();
  document = await open();
  before = shown().length;
  assert.equal(hooks.setSchema(key, SCHEMA), true);
  await sleep(SETTLE_MS);
  assert.equal(shown().length, before, 'validation ran on open above the limit');
  await waitFor('the paused item', () => hooks.pausedValidation() !== null);
  assert.deepEqual(hooks.pausedValidation(), { text: PAUSED_TEXT, command: VALIDATE_ONCE_COMMAND });
  await changeExternally(document, 'pause');
  await sleep(SETTLE_MS);
  assert.equal(shown().length, before, 'validation ran on change above the limit');

  await vscode.commands.executeCommand(VALIDATE_ONCE_COMMAND);
  await waitFor('the validation of the click', () => shown().length > before, 30000);
  const result = shown().at(-1);
  assert.equal(result.docVersion, document.version);
  assert.deepEqual(keywords(result), ['maxItems']);
  assert.ok(
    !hooks.cachedParses().includes(document.getText()),
    'the click kept a full parse of the text (it reads the data alone)',
  );
  await sleep(SETTLE_MS);
  assert.equal(shown().length, before + 1, 'the click validated more than once');

  // "Edit anyway" keeps it paused: the tab is still a large-file tab above the limit.
  await hooks.dom(key, [{ click: '.banner button', text: 'Edit anyway' }]);
  await waitFor('the unlock', () => view().largeFile.unlocked);
  before = shown().length;
  await changeExternally(document, 'again');
  await sleep(SETTLE_MS);
  assert.equal(
    shown().length,
    before,
    'validation ran on change in an unlocked tab above the limit',
  );
  assert.notEqual(hooks.pausedValidation(), null);
  hooks.setSchema(key, undefined);
  await waitFor('the item to hide without a schema', () => hooks.pausedValidation() === null);
  await document.save();
  await closeAll();
  hooks.validationLimit(undefined);
  console.log('criterion 10: above the limit, validation waits for the status-bar item');
};
