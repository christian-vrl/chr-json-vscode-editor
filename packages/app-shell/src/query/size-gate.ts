// Transform's query languages on large documents (spec 011 criterion 11, UNK-049 ★: "not above
// 5 MiB"). The size is the document text's UTF-8 length when the Transform dialog opens, not the
// size the tab opened with: an unlocked large-file tab whose text shrank gets every language back,
// and a normal tab whose text grew past the threshold loses the gated ones. Pure functions over the
// text, no DOM, so the page and unit tests share them.
import type { QueryLanguage } from 'vanilla-jsoneditor';

/** Spec 008's threshold (UNK-014): 5 MiB, the extension host's `LARGE_FILE_THRESHOLD`. */
export const QUERY_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * The ids of the languages left out of Transform above `QUERY_SIZE_LIMIT_BYTES`: the library's
 * JavaScript and Lodash (`javascriptQueryLanguage.id`, `lodashQueryLanguage.id`), which run in the
 * sealed engine (spec 011). Another language that must stay off large documents adds its id here
 * (014 T4: `'jsonpath-rfc9535'`); nothing else changes.
 */
export const SIZE_GATED_QUERY_LANGUAGES: ReadonlySet<string> = new Set(['javascript', 'lodash']);

/**
 * Whether `text` is longer than `limit` bytes in UTF-8, counted without encoding it (a 50 MiB text
 * would be copied once more). A lone surrogate counts as U+FFFD, three bytes, as `TextEncoder`
 * writes it, like the extension host's `utf8Length`.
 */
export function isAboveQuerySizeLimit(text: string, limit = QUERY_SIZE_LIMIT_BYTES): boolean {
  // Every UTF-16 code unit is at least one byte, and at most three per unit: skip the count when
  // the length alone decides.
  if (text.length > limit) return true;
  if (text.length * 3 <= limit) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

/** The languages Transform lists for a document whose text is `text`, in `languages`' order. */
export function queryLanguagesFor(languages: QueryLanguage[], text: string): QueryLanguage[] {
  if (!languages.some((language) => SIZE_GATED_QUERY_LANGUAGES.has(language.id))) return languages;
  if (!isAboveQuerySizeLimit(text)) return languages;
  return languages.filter((language) => !SIZE_GATED_QUERY_LANGUAGES.has(language.id));
}
