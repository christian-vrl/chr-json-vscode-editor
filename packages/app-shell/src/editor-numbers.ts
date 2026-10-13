// Big numbers in the editor page (spec 015 B4, 015 T4). The page's data holds each big number as a
// lossless-json `LosslessNumber` (ADR-014), so the library shows, searches and copies its digits.
// It is an `EditorNumber`, a `LosslessNumber` whose `valueOf` never throws: lossless-json's throws
// for a number that overflows or underflows a float (`1e400`, `1E-400`), and the library's sorts
// call it, so one such number made both sorts fail (spike 015 T1 REPORT §4). Everything else about
// it is lossless-json's: `instanceof LosslessNumber`, `isLosslessNumber`, `value` and `toString`,
// so core reads and writes it as any big number. The order a sort gives is B3's, set by the app
// (sort-order.ts), not by `valueOf`.
import { LosslessNumber } from '@chr-json-editor/core';

export class EditorNumber extends LosslessNumber {
  /** lossless-json's value (a number, or a `BigInt` for a big integer), or the nearest number
   *  (`Infinity`, `-Infinity`, `0`, `-0`) where lossless-json throws. */
  override valueOf(): number | bigint {
    try {
      return super.valueOf();
    } catch {
      return Number(this.value);
    }
  }
}

/** A big number of the page's data for its decimal text. */
export const editorNumber = (decimal: string): EditorNumber => new EditorNumber(decimal);

/**
 * `data` with each `LosslessNumber` that is not yet an `EditorNumber` as one. Containers that hold
 * none are returned as they are; the others are copied (core caches its parse, so its data is never
 * changed in place), with `__proto__` keys kept as members.
 */
export function editorNumbers(data: unknown): unknown {
  if (data instanceof LosslessNumber)
    return data instanceof EditorNumber ? data : new EditorNumber(data.value);
  if (typeof data !== 'object' || data === null) return data;
  if (Array.isArray(data)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < data.length; i++) {
      const item: unknown = data[i];
      const read = editorNumbers(item);
      if (read !== item) (copy ??= data.slice())[i] = read;
    }
    return copy ?? data;
  }
  let copy: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(data)) {
    const read = editorNumbers(value);
    if (read === value) continue;
    copy ??= copyOf(data as Record<string, unknown>);
    copy[key] = read;
  }
  return copy ?? data;
}

/** A plain copy of `record`, every member defined as data (so a `__proto__` key stays a member). */
function copyOf(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record))
    Object.defineProperty(copy, key, { value, writable: true, enumerable: true, configurable: true });
  return copy;
}
