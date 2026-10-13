// Gate for 011 T6 (spec 011 criterion 11, UNK-049 ★), run by suite.cjs inside VS Code on 008's
// 6 MiB fixture (largeFile.cjs `documentText`). The size is the document text's UTF-8 length when
// the Transform dialog opens, not the size the tab opened with:
// - a locked large-file tab offers no Transform (008 criterion 2);
// - unlocked with "Edit anyway", Transform lists the languages allowed above 5 MiB (JSONQuery,
//   JMESPath, JSONPath) and neither JavaScript nor Lodash; once the text has shrunk to 5 MiB or less,
//   all of them again;
// - a normal tab at exactly 5 MiB lists all of them; once its text has grown one byte past the
//   threshold, in tree and in text mode, JavaScript and Lodash are left out, and neither is
//   selected.
// The languages are read from the library's own dialog with the `dom` test hook. The fixtures are
// written into run.mjs's scratch folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const { documentText } = require('./largeFile.cjs');

const VIEW_TYPE = 'chrJsonEditor.editor';
const THRESHOLD = 5 * 1024 * 1024;
const SIX_MIB = 6 * 1024 * 1024;
/** The languages that run in the sealed engine, off above the threshold. */
const GATED = ['JavaScript', 'Lodash'];
/** The languages criterion 11 lists above the threshold. */
const ALLOWED = ['JSONQuery', 'JMESPath', 'JSONPath (Goessner)'];

exports.runQueryLargeFile = async function runQueryLargeFile({
  hooks,
  waitFor,
  closeAll,
  expectOnly,
  isCustom,
}) {
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const dir = fs.mkdtempSync(path.join(scratch, 'query-large-file-'));
  const view = (uri) => hooks.webviews().find((w) => w.uri === uri.toString());

  async function probeUntil(uri, what, predicate, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let probe;
    for (;;) {
      probe = await hooks.probe(uri.toString());
      if (predicate(probe)) return probe;
      if (Date.now() > deadline) {
        const rest = { ...probe, content: probe.content && '(omitted)' };
        throw new Error(`timed out waiting for ${what}; last probe: ${JSON.stringify(rest)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Whether the editor shows data whose first item's marker is `marker`. */
  const shows = (probe, marker) => {
    if (!probe.content) return false;
    const data = 'json' in probe.content ? probe.content.json : undefined;
    if (data !== undefined) return Array.isArray(data) && data[0]?.marker === marker;
    return probe.content.text.includes(`"marker": "${marker}"`);
  };

  /** Opens `name` with `text` in CHR JSON Editor and waits until the editor shows it. */
  async function open(name, text) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    await waitFor(`the ${name} webview`, () => view(uri)?.scriptLoaded, 60000);
    await probeUntil(uri, 'the document in the editor', (p) => p.mode === 'tree' && !!p.content);
    return { uri, document };
  }

  /** Replaces `search` in the document with `replacement` from outside the editor, and waits until
   *  the editor shows the first marker `marker`. */
  async function change({ uri, document }, search, replacement, marker, mode = 'tree') {
    const text = document.getText();
    const from = search === null ? 0 : text.indexOf(search);
    const to = search === null ? text.length : from + search.length;
    assert.ok(from >= 0, `"${search}" is not in the document`);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      uri,
      new vscode.Range(document.positionAt(from), document.positionAt(to)),
      replacement,
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    await probeUntil(uri, `the "${marker}" text`, (p) => p.mode === mode && shows(p, marker));
    return Buffer.byteLength(document.getText());
  }

  /** Opens Transform from the main menu, reads the languages it lists and the selected one, and
   *  closes it (picking the selected one again closes the list). */
  async function languages(uri, mode = 'tree') {
    const [listed, selected] = await hooks.dom(uri.toString(), [
      { click: `.jse-${mode}-mode .jse-transform` },
      // A Transform that lists JavaScript waits for the engine to load and compile first.
      { click: '.jse-modal .jse-config' },
      { readAll: '.jse-query-language' },
      { read: '.jse-query-language.selected' },
      { click: '.jse-query-language.selected' },
      { click: '.jse-modal .jse-close' },
      { waitFor: '.jse-modal', gone: true },
    ]);
    return { listed: JSON.parse(listed), selected: selected.trim() };
  }

  /** The list above the threshold: `all` without JavaScript and Lodash, criterion 11's three
   *  included, and a selected language that is listed. */
  function assertGated(shown, all, where) {
    assert.deepEqual(
      shown.listed,
      all.filter((name) => !GATED.includes(name)),
      `${where}: languages`,
    );
    for (const name of ALLOWED) assert.ok(shown.listed.includes(name), `${where}: no ${name}`);
    assert.ok(shown.listed.includes(shown.selected), `${where}: ${shown.selected} selected`);
  }

  // A normal tab at the threshold lists every language; one byte more and the engine's are off.
  await closeAll();
  const normal = await open('at-threshold.json', documentText('json', THRESHOLD));
  assert.equal(view(normal.uri).largeFile, null, 'the tab at the threshold is a large-file tab');
  const atThreshold = await languages(normal.uri);
  const all = atThreshold.listed;
  for (const name of [...ALLOWED, ...GATED]) assert.ok(all.includes(name), `no ${name} listed`);
  console.log(`criterion 11: at ${THRESHOLD} bytes Transform lists ${all.join(', ')}`);

  const grown = await change(normal, '"marker": "start"', '"marker": "grown!"', 'grown!');
  assert.equal(grown, THRESHOLD + 1);
  assert.equal(view(normal.uri).largeFile, null, 'the grown tab became a large-file tab');
  const grownTree = await languages(normal.uri);
  assertGated(grownTree, all, 'normal tab grown, tree mode');
  assert.equal(hooks.setMode(normal.uri.toString(), 'text'), true);
  await probeUntil(normal.uri, 'text mode', (p) => p.mode === 'text');
  assertGated(await languages(normal.uri, 'text'), all, 'normal tab grown, text mode');
  console.log(
    `criterion 11: a normal tab grown to ${grown} bytes lists ${grownTree.listed.join(', ')} ` +
      'in tree and text mode',
  );
  // Scratch files: saved, so closing the tab asks nothing.
  await normal.document.save();
  await closeAll();

  // A large-file tab: locked, no Transform; unlocked, the engine's languages are off until the
  // text has shrunk to the threshold or less.
  const large = await open('six.json', documentText('json', SIX_MIB));
  const largeKey = large.uri.toString();
  assert.deepEqual(view(large.uri).largeFile, { bytes: SIX_MIB, unlocked: false });
  await hooks.dom(largeKey, [
    { waitFor: '.jse-tree-mode .jse-menu' },
    { waitFor: '.jse-transform', gone: true },
  ]);
  console.log('criterion 11: a locked large-file tab offers no Transform');

  await hooks.dom(largeKey, [{ click: '.banner button', text: 'Edit anyway' }]);
  await waitFor('the unlock', () => view(large.uri).largeFile.unlocked);
  const unlocked = await languages(large.uri);
  assertGated(unlocked, all, 'large-file tab unlocked');
  console.log(
    `criterion 11: unlocked at ${SIX_MIB} bytes Transform lists ${unlocked.listed.join(', ')}`,
  );

  const shrunk = await change(large, null, '[\n  {"marker": "small"}\n]\n', 'small');
  assert.ok(shrunk <= THRESHOLD);
  assert.deepEqual(view(large.uri).largeFile, { bytes: SIX_MIB, unlocked: true });
  const small = await languages(large.uri);
  assert.deepEqual(small.listed, all, 'unlocked tab shrunk: languages');
  const probe = await hooks.probe(largeKey);
  assert.deepEqual(probe.violations, [], 'CSP violations');
  console.log(
    `criterion 11: the unlocked tab shrunk to ${shrunk} bytes lists ${small.listed.join(', ')}`,
  );

  await large.document.save();
  await closeAll();
};
