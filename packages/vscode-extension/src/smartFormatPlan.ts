// What Smart Format (spec 010 T3) does to a document's text, as a pure function with no `vscode`
// import so unit tests can call it; the webview's `smartFormat` action (documentSync.ts) and the
// "Smart Format" command (smartFormatCommand.ts) both run it. The layout is core's `smartFormat`
// (010 T2); this adds the size guard of criterion 10, checked first, and criterion 9's message.
import { PatchError, smartFormat, type SmartFormatFormat } from '@chr-json-editor/core';
import { FORMAT_LABELS } from './convertPlan';
import { LARGE_FILE_THRESHOLD, utf8Length } from './largeFile';

/** Criterion 10: why a document above the threshold is not smart-formatted. */
export const TOO_LARGE_MESSAGE =
  'Smart Format is off for documents above 5 MiB because it can take a long time. Use Format instead.';

/** Why a JSON Lines document is not smart-formatted (spec 010 §Scope); no menu offers it. */
export const JSONL_MESSAGE = 'Smart Format does not lay out JSON Lines documents.';

/** Criterion 9: why a document that does not parse is not smart-formatted. */
export function brokenMessage(format: SmartFormatFormat): string {
  return `Smart Format needs valid ${FORMAT_LABELS[format]}. Fix the errors or run Repair JSON first.`;
}

export type SmartFormatPlan =
  | { kind: 'formatted'; text: string }
  /** Already smart-formatted, or no value: no edit (criterion 8). */
  | { kind: 'same' }
  /** Not run: `message` says why (criteria 9 and 10). */
  | { kind: 'refused'; reason: 'too-large' | 'broken'; message: string };

/** Criterion 10: whether `text` is above the threshold, by its UTF-8 length. */
export function tooLarge(text: string): boolean {
  // Every UTF-16 code unit is one to three bytes: skip the count when the length alone decides.
  return text.length * 3 > LARGE_FILE_THRESHOLD && utf8Length(text) > LARGE_FILE_THRESHOLD;
}

/**
 * Smart Format on `text` read as `format`. "Size" is the UTF-8 length of the text now, whatever
 * mode its tab opened in (criterion 10), so a large-file tab edited down to the threshold runs.
 */
export function plan(text: string, format: SmartFormatFormat): SmartFormatPlan {
  if (tooLarge(text)) return { kind: 'refused', reason: 'too-large', message: TOO_LARGE_MESSAGE };
  let formatted: string;
  try {
    formatted = smartFormat(text, format);
  } catch (error) {
    if (!(error instanceof PatchError)) throw error;
    return { kind: 'refused', reason: 'broken', message: brokenMessage(format) };
  }
  return formatted === text ? { kind: 'same' } : { kind: 'formatted', text: formatted };
}
