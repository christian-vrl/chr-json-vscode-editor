// Spec 019 I1 (UNK-088 ★) helpers for the e2e suites: new text is indented as VS Code's
// `editor.tabSize` and `editor.insertSpaces` say for the language, so a suite that checks written
// bytes either sets them (`withIndent`) or re-indents its two-space expectation (`reindent`). The
// desktop e2e opens no workspace folder, so values are user settings (ConfigurationTarget.Global),
// as settings.cjs and smartFormatSettings.cjs write theirs.
const vscode = require('vscode');

/** VS Code's own defaults, which every suite runs at unless it sets another value. */
exports.DEFAULT_UNIT = '    ';

/**
 * Runs `fn` with `editor.tabSize` and `editor.insertSpaces` set as `values` says, for each language
 * in `languages` (`"[json]": {...}`), or for every language when `languages` is empty, and removes
 * the values again afterwards. `waitFor` is the suite's poller.
 */
exports.withIndent = async function withIndent(waitFor, languages, values, fn) {
  const scopes = languages.length > 0 ? languages.map((languageId) => ({ languageId })) : [{}];
  const set = async (value) => {
    for (const scope of scopes) {
      const editor = vscode.workspace.getConfiguration('editor', scope);
      for (const [key, v] of Object.entries(values)) {
        await editor.update(
          key,
          value ? v : undefined,
          vscode.ConfigurationTarget.Global,
          scope.languageId !== undefined,
        );
      }
    }
    await waitFor(`editor indentation ${JSON.stringify(value ? values : 'cleared')}`, () =>
      scopes.every((scope) => {
        const editor = vscode.workspace.getConfiguration('editor', scope);
        return Object.entries(values).every(([key, v]) => {
          const inspected = editor.inspect(key);
          const read = scope.languageId ? inspected?.globalLanguageValue : inspected?.globalValue;
          return read === (value ? v : undefined);
        });
      }),
    );
  };
  await set(true);
  try {
    return await fn();
  } finally {
    await set(false);
  }
};

/** `text`, written with a two-space unit (`JSON.stringify(value, null, 2)`), with `unit` instead.
 *  Only leading white space changes, so strings and values stay as written. */
exports.reindent = function reindent(text, unit) {
  return text.replace(/^(?: {2})+/gm, (spaces) => unit.repeat(spaces.length / 2));
};

/** Spec 019 criterion 6's `"[json]"` values, each with the unit new text gets: 4 spaces, and a tab
 *  with `editor.insertSpaces` false. */
exports.CRITERION_6 = [
  [{ tabSize: 4, insertSpaces: true }, '    '],
  [{ tabSize: 4, insertSpaces: false }, '\t'],
];
