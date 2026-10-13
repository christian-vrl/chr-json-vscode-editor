// The JSON Lines generator of spec 012 criterion 3 (012 T2), shared with criterion 5's convert
// property suite (012 T3), which runs over the same texts.
import fc from 'fast-check';
import { dataArbitrary } from './arbitraries.js';

/** Keys `immutable-json-patch` 6.0.3 mishandles (see patch.property.test.ts): left out. */
export const usable = (key: string) => !(key in Object.prototype) && key !== '-';

function plain(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(plain);
  if (data !== null && typeof data === 'object') {
    const object: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (usable(k)) object[k] = plain(v);
    return object;
  }
  return data;
}

/** JSON values as a JSON Lines line holds them: what `JSON.parse(JSON.stringify(v))` gives. */
export const jsonlValue = dataArbitrary('json').map(
  (v) => JSON.parse(JSON.stringify(plain(v))) as unknown,
);

export const pad = fc.constantFrom('', '', ' ', '\t', '  ', ' \t');

/** An item line: a value as `JSON.stringify` writes it, with spaces and tabs around. */
export const jsonlLine = fc
  .tuple(pad, jsonlValue, pad)
  .map(([a, v, b]) => a + JSON.stringify(v) + b);

/** A JSON Lines text: items written as `JSON.stringify` writes them with spaces and tabs around,
 *  blank lines before, between and after, one line ending, a final newline or not. */
export const jsonlText = fc
  .record({
    lines: fc.array(fc.oneof({ weight: 3, arbitrary: jsonlLine }, { weight: 1, arbitrary: pad }), {
      maxLength: 8,
    }),
    eol: fc.constantFrom('\n', '\r\n'),
    finalNewline: fc.boolean(),
  })
  .map(({ lines, eol, finalNewline }) =>
    lines.length === 0 ? '' : lines.join(eol) + (finalNewline ? eol : ''),
  );
