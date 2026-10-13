// What reading a written number back gives (spec 015 B1), for the round-trip properties of spec 002
// criterion 6 and spec 015 criterion 2: `stringify` writes a plain number as `JSON.stringify` does
// (002 R8), and the digits it writes for a whole number from 2^53 up to 1e21 (`2 ** 60` →
// `1152921504606846976`) are a big number, which reads back as a `LosslessNumber` with those digits
// and the original number as its nearest number.
import { isSafeNumber } from 'lossless-json';
import { LosslessNumber } from '../src/index.js';

/** `x` with each plain number that JavaScript writes as a big number replaced by that big number.
 *  Every other value is kept, `__proto__` members as members. */
export function readBack(x: unknown): unknown {
  if (typeof x === 'number') {
    const text = JSON.stringify(x);
    return Number.isFinite(x) && !isSafeNumber(text) ? new LosslessNumber(text) : x;
  }
  if (Array.isArray(x)) return x.map(readBack);
  if (typeof x !== 'object' || x === null || x instanceof LosslessNumber) return x;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(x))
    Object.defineProperty(copy, key, {
      value: readBack(value),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return copy;
}
