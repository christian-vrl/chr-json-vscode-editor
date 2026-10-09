// When core's cached parses (UNK-014, core/formats/cache.ts) can go (003 T11 follow-up). Only the
// host's work for open CHR JSON Editor tabs parses text (format badge, validation, the schema it
// reads, edits), so once the last tab closes every cached parse goes. While tabs stay open, a
// closed JSON document drops the parse of its text; a document of any other language is skipped
// without reading its text, which for a big file would be built just to be compared.

/** The parts of a closed `vscode.TextDocument` this reads. */
export interface ClosedDocument {
  languageId: string;
  uri: { path: string };
  getText(): string;
}

const JSON_LANGUAGES = new Set(['json', 'jsonc', 'json5']);
const JSON_EXTENSION = /\.(json|jsonc|json5)$/i;

/** What to drop when `document` closes, or a tab showing it closes: `'all'` for every cached
 *  parse, the text whose parse to drop, or nothing. `editorsOpen` counts the tabs left open. */
export function parseToRelease(
  document: ClosedDocument,
  editorsOpen: number,
): 'all' | { text: string } | undefined {
  if (editorsOpen === 0) return 'all';
  if (!JSON_LANGUAGES.has(document.languageId) && !JSON_EXTENSION.test(document.uri.path)) {
    return undefined;
  }
  return { text: document.getText() };
}
