// Large-file mode in the host (spec 008 T3). The mode is chosen once, when a tab opens: a document
// whose text is longer than the threshold in UTF-8 (criterion 1) opens read-only, and the host
// reads it with core's data-only `parseData` instead of the full `parse` that core caches (criterion
// 8): the format badge, validation and the top-level `$schema` all take its data from `dataOf`.
// No `vscode` import, so unit tests run it directly.
import type { LargeFile } from '@chr-json-editor/app-shell/protocol';
import { parseData, type Format, type ParseDataResult } from '@chr-json-editor/core';

/** 5 MiB (UNK-014): a text of more bytes than this opens in large-file mode. */
export const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

/** The message a locked tab's `edit` gets back (the `read-only` edit error, criterion 2). */
export const READ_ONLY_MESSAGE =
  'This large file is read-only. Choose "Edit anyway" to edit it, or "Open as Text".';

/**
 * The UTF-8 length of `text` in bytes, counted without encoding it (a 50 MiB text would be copied
 * once more). A lone surrogate counts as U+FFFD, three bytes, as `TextEncoder` writes it.
 */
export function utf8Length(text: string): number {
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
  }
  return bytes;
}

/** The large-file state of a tab that opens on `text`: locked when above the threshold, else
 *  null (the normal editor). */
export function largeFileFor(text: string): LargeFile | null {
  // Every UTF-16 code unit is at least one byte, and at most three per unit: skip the count when
  // the length alone decides.
  if (text.length * 3 <= LARGE_FILE_THRESHOLD) return null;
  const bytes = utf8Length(text);
  return bytes > LARGE_FILE_THRESHOLD ? { bytes, unlocked: false } : null;
}

/** How long `dataOf` keeps its last result: the badge, the `$schema` lookup and validation read
 *  the same text within moments of each other when a tab opens or the format changes. */
const KEEP_MS = 2000;
let last: { format: Format; text: string; result: ParseDataResult } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** `parseData(format, text)`, shared for a moment by the callers that read the same text. */
export function dataOf(format: Format, text: string): ParseDataResult {
  if (last?.format !== format || last.text !== text) {
    last = { format, text, result: parseData(format, text) };
  }
  clearTimeout(timer);
  timer = setTimeout(() => (last = undefined), KEEP_MS);
  return last.result;
}

/** The data of `text`, or why it has none: its first parse error, or no value at all. */
export function dataOrError(format: Format, text: string): { data: unknown } | { error: string } {
  const result = dataOf(format, text);
  if ('error' in result) return { error: result.error.message };
  // Only text without a value (empty, whitespace, comments) parses to undefined.
  if (result.data === undefined) return { error: 'The document holds no value' };
  return { data: result.data };
}
