// Gate for 007 T2 (spec 007 criterion 5, UNK-038), run by suite.cjs inside VS Code. The HEAD reader
// returns a committed file's bytes exactly as committed, through VS Code's Git extension, while the
// document has an unsaved edit; an untracked file is "not in HEAD" and a file outside any repository
// is "not in a repository". The repository is a temporary one made with the `git` on PATH, in run.mjs's scratch folder.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

/** A UTF-8 BOM, CRLF line ends and a non-ASCII character: bytes a decoding read would change. */
const COMMITTED = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('{\r\n  // café\r\n  "name": "CHR",\r\n  "n": 1\r\n}\r\n', 'utf8'),
]);

function git(cwd, ...args) {
  // No user config on CI runners; autocrlf off so the commit keeps the CRLF bytes on every OS.
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@example.invalid',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd },
  );
}

/**
 * @param {object} t
 * @param {any} t.hooks the extension's test hooks
 * @param {(what: string, predicate: () => boolean, timeoutMs?: number) => Promise<void>} t.waitFor
 * @param {() => Promise<void>} t.closeAll
 */
exports.runGitHead = async function runGitHead({ hooks, waitFor, closeAll }) {
  // run.mjs's profile folder, outside any repository and deleted after VS Code exits.
  const scratch = process.env.CHR_E2E_SCRATCH;
  assert.ok(scratch, 'CHR_E2E_SCRATCH is not set');
  const repo = fs.mkdtempSync(path.join(scratch, 'git-'));
  const outside = fs.mkdtempSync(path.join(scratch, 'nogit-'));
  try {
    git(repo, 'init', '-q');
    fs.mkdirSync(path.join(repo, 'sub'));
    const committed = path.join(repo, 'sub', 'data.jsonc');
    fs.writeFileSync(committed, COMMITTED);
    git(repo, 'add', 'sub/data.jsonc');
    git(repo, 'commit', '-q', '-m', 'fixture');
    const untracked = path.join(repo, 'sub', 'new.json');
    fs.writeFileSync(untracked, '{"new": true}\n');
    const loose = path.join(outside, 'loose.json');
    fs.writeFileSync(loose, '{"loose": true}\n');
    // What Git stores, read with git itself: the reference the reader must match byte for byte.
    const stored = git(repo, 'cat-file', 'blob', 'HEAD:sub/data.jsonc');
    assert.deepEqual(stored, COMMITTED, 'the fixture commit changed the bytes');

    // A committed file with an unsaved edit: HEAD is the committed bytes, not the edited text.
    const uri = vscode.Uri.file(committed);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), '// unsaved\n');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await waitFor('the edit to make the document dirty', () => document.isDirty);
    // Read twice: the first may open the repository (none is open in this empty window unless the
    // Git extension found it from the open editor), the second finds it open.
    for (const pass of ['first read', 'second read']) {
      const result = await hooks.readHead(uri.toString());
      assert.equal(result.kind, 'head', `${pass}: ${JSON.stringify(result)}`);
      assert.ok(
        Buffer.from(result.bytes).equals(stored),
        `${pass}: HEAD bytes differ from the commit: ${JSON.stringify(Buffer.from(result.bytes).toString())}`,
      );
    }
    assert.equal(document.isDirty, true, 'reading HEAD must not touch the document');
    console.log('git HEAD: committed bytes read byte-equal under an unsaved edit');

    const untrackedResult = await hooks.readHead(vscode.Uri.file(untracked).toString());
    assert.deepEqual(untrackedResult, { kind: 'not-in-head' });
    console.log('git HEAD: an untracked file is not in HEAD');

    const looseResult = await hooks.readHead(vscode.Uri.file(loose).toString());
    assert.deepEqual(looseResult, { kind: 'no-repository' });
    console.log('git HEAD: a file outside Git is not in a repository');

    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await waitFor('the unsaved edit to revert', () => !document.isDirty);
    await closeAll();
  } finally {
    // The read opened the repository in VS Code's Git view, as opening a file in it would. Closing
    // it is not enough to delete the folder here: the Git extension still runs `git` in it for a
    // moment (spawn ENOENT in the log), so run.mjs deletes the scratch folder after VS Code exits.
    await vscode.commands.executeCommand('git.close', vscode.Uri.file(repo));
  }
};
