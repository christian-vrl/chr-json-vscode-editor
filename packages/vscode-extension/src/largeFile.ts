// Large-file mode in the host (spec 008 T3). The mode is chosen once, when a tab opens: a document
// whose text is longer than the threshold in UTF-8 (criterion 1) opens read-only, and the host
// reads it with core's data-only `parseData` instead of the full `parse` that core caches (criterion
// 8): the format badge, validation and the top-level `$schema` all take its data from `dataOf`.
// No `vscode` import, so unit tests run it directly.
// The threshold is the `chrJsonEditor.largeFileThreshold` setting (spec 019 T1, UNK-087 ★), read
// when each check runs: `thresholdBytes` is the one place every host gate gets it from (plan R6),
// and `LARGE_FILE_THRESHOLD` is its default.
import type { LargeFile } from '@chr-json-editor/app-shell/protocol';
import { parseData, type Format, type ParseDataResult } from '@chr-json-editor/core';
import type { Settings } from './settings';

/** Bytes in a MiB: the threshold setting is in whole MiB (spec 019 Terms). */
const MIB = 1024 * 1024;

/** The threshold at its default, 5 MiB (UNK-014): a text of more bytes than this opens in
 *  large-file mode when the setting is not set. */
export const LARGE_FILE_THRESHOLD = 5 * MIB;

/** Spec 019 T1: the threshold in bytes for a document's settings (MiB × 1,048,576). */
export function thresholdBytes(settings: Pick<Settings, 'largeFileThreshold'>): number {
  return settings.largeFileThreshold * MIB;
}

/** The threshold as the messages name it: "5 MiB" at the default. */
export function thresholdLabel(threshold: number): string {
  return `${threshold / MIB} MiB`;
}

/** Whether `text` is above `threshold` bytes, by its UTF-8 length. */
export function aboveThreshold(text: string, threshold = LARGE_FILE_THRESHOLD): boolean {
  // Every UTF-16 code unit is one to three bytes: skip the count when the length alone decides.
  return text.length * 3 > threshold && utf8Length(text) > threshold;
}

/**
 * UNK-041 (spec 008 criterion 10): the largest large-file text, in UTF-8 bytes, whose schema
 * validation still runs on open and on change. Above it validation is paused and runs once per
 * click on the status-bar item (pausedValidation.ts). 10 MiB per UNK-041's evidence rule:
 * `bench/large-file.md` (008 T5, run 38169445043) times one validation at 38 / 228 / 131 ms for
 * JSON / JSONC / JSON5 at 10 MiB and 224 / 1,233 / 682 ms at 50 MiB, so 10 MiB is the largest
 * measured size under 1 s for every format.
 */
export const VALIDATION_LIMIT_BYTES = 10 * 1024 * 1024;

/** Test hooks (008 T5 e2e): a limit to use in place of UNK-041's; undefined uses UNK-041's. */
export const testValidationLimit: { bytes: number | undefined } = { bytes: undefined };

/** Whether validation of a tab in `largeFile` state is paused (criterion 10): a large-file tab,
 *  locked or not, above UNK-041's limit. */
export function validationPaused(largeFile: LargeFile | null): boolean {
  return (
    largeFile !== null && largeFile.bytes > (testValidationLimit.bytes ?? VALIDATION_LIMIT_BYTES)
  );
}

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

/** The large-file state of a tab that opens on `text`: locked when above `threshold` bytes, else
 *  null (the normal editor). */
export function largeFileFor(text: string, threshold = LARGE_FILE_THRESHOLD): LargeFile | null {
  // Every UTF-16 code unit is at least one byte, and at most three per unit: skip the count when
  // the length alone decides.
  if (text.length * 3 <= threshold) return null;
  const bytes = utf8Length(text);
  return bytes > threshold ? { bytes, unlocked: false } : null;
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

/** Drops `dataOf`'s kept result at once: at 50 MiB its data holds about a gigabyte (008 T3
 *  review), which nothing needs once the tab that read it closed. */
export function releaseData(): void {
  clearTimeout(timer);
  last = undefined;
}

/** The data of `text`, or why it has none: its first parse error, or no value at all. */
export function dataOrError(format: Format, text: string): { data: unknown } | { error: string } {
  const result = dataOf(format, text);
  if ('error' in result) return { error: result.error.message };
  // Only text without a value (empty, whitespace, comments) parses to undefined.
  if (result.data === undefined) return { error: 'The document holds no value' };
  return { data: result.data };
}
