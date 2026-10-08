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
const VALIDATION = path.resolve(__dirname, '../../../../tests/e2e/fixtures/validation');

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
  if (!tab) return 'no tab';
  if (isCustom(tab)) return `custom editor ${tab.input.viewType}`;
  return isText(tab) ? 'text editor' : 'other editor';
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

// Criterion 6 (003 T4): parse the CSP <meta> out of the webview HTML the provider set.
function unescapeHtml(text) {
  return text.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e],
  );
}

function parseCsp(html) {
  const metas = [
    ...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/gi),
  ];
  assert.equal(metas.length, 1, 'expected exactly one CSP <meta>');
  const head = html.slice(0, html.search(/<\/head>/i));
  assert.ok(head.includes(metas[0][0]), 'the CSP <meta> must be in <head>');
  assert.ok(
    head.indexOf(metas[0][0]) <
      Math.min(
        ...['<script', '<link', '<style'].map((t) => {
          const i = html.indexOf(t);
          return i === -1 ? Infinity : i;
        }),
      ),
    'the CSP <meta> must come before any script or stylesheet',
  );
  const directives = new Map();
  for (const part of unescapeHtml(metas[0][1]).split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!directives.has(name.toLowerCase()), `duplicate CSP directive ${name}`);
    directives.set(name.toLowerCase(), sources);
  }
  return { policy: unescapeHtml(metas[0][1]), directives };
}

const NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/]+={0,2})'$/;

function assertCriterion6(snapshot) {
  const { policy, directives } = parseCsp(snapshot.html);
  const name = path.basename(vscode.Uri.parse(snapshot.uri).fsPath);
  assert.deepEqual(directives.get('default-src'), ["'none'"], `${name}: default-src`);

  const scriptSrc = directives.get('script-src') ?? [];
  assert.equal(scriptSrc.length, 1, `${name}: script-src must be a nonce only, got ${scriptSrc}`);
  const match = NONCE_SOURCE.exec(scriptSrc[0]);
  assert.ok(match, `${name}: script-src must be a nonce only, got ${scriptSrc}`);
  const nonce = match[1];
  assert.ok(Buffer.from(nonce, 'base64').length >= 16, `${name}: nonce shorter than 128 bits`);

  // webview.cspSource can be several sources (VS Code 1.141: `'self' https://*.vscode-cdn.net`,
  // the origin it serves localResourceRoots from inside the webview, not the network).
  const webviewSources = snapshot.cspSource.split(/\s+/).filter(Boolean);
  const allowed = [...webviewSources, `'nonce-${nonce}'`];
  const styleSrc = directives.get('style-src') ?? [];
  assert.deepEqual(
    [...styleSrc].sort(),
    [...allowed].sort(),
    `${name}: style-src must be the webview source and the nonce`,
  );
  assert.deepEqual(directives.get('connect-src'), ["'none'"], `${name}: connect-src`);
  assert.ok(!/unsafe-eval/i.test(policy), `${name}: CSP allows unsafe-eval`);
  assert.ok(!/unsafe-inline|unsafe-hashes/i.test(policy), `${name}: CSP allows inline code`);
  // Any other fetch directive may only name the webview source or the nonce, so nothing loads
  // from the network (offline invariant, AGENTS.md rule 3).
  for (const [directive, sources] of directives) {
    if (!directive.endsWith('-src')) continue;
    for (const source of sources) {
      assert.ok(
        source === "'none'" || allowed.includes(source),
        `${name}: ${directive} allows ${source}`,
      );
    }
  }

  // Every script is external and carries the nonce; no inline script or style element.
  const scripts = [...snapshot.html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${name}: no script`);
  for (const [, attributes, content] of scripts) {
    assert.ok(attributes.includes(` nonce="${nonce}"`), `${name}: script without the nonce`);
    assert.equal(content.trim(), '', `${name}: inline script`);
  }
  assert.ok(!/<style\b/i.test(snapshot.html), `${name}: inline <style> element`);

  // localResourceRoots: only the extension's dist folder.
  const dist = vscode.Uri.joinPath(extensionUri(), 'dist').toString();
  assert.equal(snapshot.enableScripts, true, `${name}: scripts disabled`);
  assert.deepEqual(snapshot.localResourceRoots, [dist], `${name}: localResourceRoots`);
  return nonce;
}

let installedExtension;
function extensionUri() {
  return installedExtension.extensionUri;
}

exports.run = async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not installed`);
  installedExtension = extension;

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

  // Gate (003 T4): criterion 6 on the webview of each format, read through the test-only hook.
  const hooks = extension.exports && extension.exports.testHooks;
  assert.ok(hooks, 'the .vsix has no test hooks; package it with CHR_TEST_HOOKS=1 (see run.mjs)');
  await closeAll();
  const nonces = new Set();
  for (const format of FORMATS) {
    const uri = fixture(format);
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    await expectOnly(uri, 'custom', isCustom);
    const snapshot = () => hooks.webviews().find((w) => w.uri === uri.toString());
    await waitFor(`the sample.${format} webview`, () => snapshot() !== undefined);
    nonces.add(assertCriterion6(snapshot()));
    // The script ran: the nonce, localResourceRoots and asWebviewUri line up.
    await waitFor(`the sample.${format} webview script to run`, () => snapshot().scriptLoaded);
    console.log(`sample.${format}: CSP meets criterion 6 and the nonce script ran`);
  }
  assert.equal(nonces.size, FORMATS.length, 'each webview must get its own nonce');

  // Gate (004 T2, ADR-010): Ajv runs in the extension host and the webview receives the errors
  // keyed by docVersion. The placeholder webview decodes each message with app-shell's protocol
  // decoder and reports what it got; the CSP checked above has no unsafe-eval.
  await closeAll();
  const personUri = vscode.Uri.file(path.join(VALIDATION, 'person.jsonc'));
  const schema = JSON.parse(
    require('node:fs').readFileSync(path.join(VALIDATION, 'person.schema.json'), 'utf8'),
  );
  const person = await vscode.workspace.openTextDocument(personUri);
  await vscode.commands.executeCommand('vscode.openWith', personUri, VIEW_TYPE);
  await expectOnly(personUri, 'custom', isCustom);
  const personView = () => hooks.webviews().find((w) => w.uri === personUri.toString());
  await waitFor('the person.jsonc webview script to run', () => personView()?.scriptLoaded);
  assertCriterion6(personView());
  assert.equal(hooks.setSchema(personUri.toString(), schema), true, 'no editor for person.jsonc');
  const shown = () => personView().validationsShown;
  await waitFor('validation errors in the webview', () => shown().length === 1);
  const keys = (errors) => errors.map(({ instancePath, keyword }) => ({ instancePath, keyword }));
  assert.equal(shown()[0].docVersion, person.version, 'validation must carry the document version');
  assert.deepEqual(keys(shown()[0].errors), [
    { instancePath: '/age', keyword: 'type' },
    { instancePath: '/email', keyword: 'format' },
    { instancePath: '/name', keyword: 'minLength' },
  ]);
  console.log(`person.jsonc v${person.version}: 3 schema errors reached the webview`);

  // A fix to the document is validated again and the result names the new version.
  const before = person.version;
  const fix = new vscode.WorkspaceEdit();
  fix.replace(
    personUri,
    new vscode.Range(person.positionAt(0), person.positionAt(person.getText().length)),
    '{\n  "name": "Ada",\n  "age": 36\n}\n',
  );
  assert.equal(await vscode.workspace.applyEdit(fix), true);
  assert.ok(person.version > before, 'the edit must bump the document version');
  await waitFor('validation of the fixed document', () => shown().length === 2);
  assert.equal(shown()[1].docVersion, person.version);
  assert.deepEqual(shown()[1].errors, []);
  console.log(`person.jsonc v${person.version}: valid after the fix`);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('the fix to revert', () => !person.isDirty);

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

  // A swap never closes a tab with unsaved edits: closing it would ask to save, and "Don't Save"
  // (the answer VS Code gives in extension tests) reverts the shared document.
  await closeAll();
  const dirtyUri = fixture('jsonc');
  const document = await vscode.workspace.openTextDocument(dirtyUri);
  const original = document.getText();
  const edited = `// unsaved\n${original}`;
  await vscode.window.showTextDocument(document);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(dirtyUri, new vscode.Position(0, 0), '// unsaved\n');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await vscode.commands.executeCommand(OPEN_COMMAND);
  await waitFor('the custom editor beside the unsaved text tab', () => {
    const tabs = tabsFor(dirtyUri);
    return tabs.length === 2 && tabs.some(isText) && isCustom(activeTab());
  });
  assert.equal(document.isDirty, true);
  assert.equal(document.getText(), edited);
  await vscode.commands.executeCommand(REOPEN_AS_TEXT_COMMAND);
  await waitFor('the unsaved text tab to be active again', () => isText(activeTab()));
  assert.equal(tabsFor(dirtyUri).length, 2);
  assert.equal(document.isDirty, true);
  assert.equal(document.getText(), edited);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('the unsaved edit to revert', () => !document.isDirty);
  assert.equal(document.getText(), original);
  console.log('unsaved edits survive both commands');

  // Opening from the explorer with nothing open lands in the custom editor too.
  await closeAll();
  await vscode.commands.executeCommand(OPEN_COMMAND, fixture('json5'));
  await expectOnly(fixture('json5'), 'custom', isCustom);
  await closeAll();

  // UNK-004's "setting" is VS Code's own editor association (README): with it, a plain open uses
  // the custom editor.
  const workbench = vscode.workspace.getConfiguration('workbench');
  await workbench.update(
    'editorAssociations',
    { '*.json5': VIEW_TYPE },
    vscode.ConfigurationTarget.Global,
  );
  await vscode.commands.executeCommand('vscode.open', fixture('json5'));
  await expectOnly(fixture('json5'), 'custom', isCustom);
  await workbench.update('editorAssociations', undefined, vscode.ConfigurationTarget.Global);
  await closeAll();
  console.log('workbench.editorAssociations makes it the default editor');

  console.log(
    `${EXTENSION_ID} ${extension.packageJSON.version} is active from ${extension.extensionPath}`,
  );
};
