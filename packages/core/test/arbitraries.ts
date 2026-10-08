// fast-check generators for format-core property tests (spec 002 criteria 3 and 6). 002 T7 uses
// `dataArbitrary` and `styleArbitrary`; 002 T6's patch suite can reuse them.
import fc from 'fast-check';
import type { Format, Style } from '../src/index.js';

/** Fixed seed so a failure reproduces (spec 002 criterion 3: seed committed). */
export const SEED = 20261008;

/** Strings that exercise quoting, escapes, identifier checks and prototype keys, mixed with any
 *  string of code points. */
const tricky = fc.constantFrom(
  '',
  'a',
  '$_x1',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'null',
  'true',
  'Infinity',
  'NaN',
  '0',
  '1e3',
  '-a',
  'a b',
  "it's",
  'say "hi"',
  `both ' and "`,
  'back\\slash',
  '\\"',
  "\\'",
  'tab\there',
  'line\nbreak',
  'cr\r\nlf',
  '  ',
  '\u0000\u001f',
  'ünïcödé',
  '日本',
  '😀',
  '\ud800',
  '/* not a comment */',
  '// not a comment',
);
const text = fc.oneof(tricky, fc.string({ unit: 'binary', maxLength: 12 }));

const number = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(0, -0, 1e21, 5e-324, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE),
);

/** Values plain data can hold in a format: JSON values, plus `Infinity`, `-Infinity` and `NaN` in
 *  JSON5, which its parser produces from those literals. */
export function dataArbitrary(format: Format): fc.Arbitrary<unknown> {
  const scalar = fc.oneof(
    fc.constant(null),
    fc.boolean(),
    format === 'json5' ? fc.oneof(number, fc.constantFrom(Infinity, -Infinity, NaN)) : number,
    text,
  );
  const { data } = fc.letrec<{ data: unknown }>((tie) => ({
    data: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      scalar,
      fc.array(tie('data'), { maxLength: 5 }),
      fc
        .uniqueArray(fc.tuple(text, tie('data')), { maxLength: 5, selector: ([k]) => k })
        .map(toObject),
    ),
  }));
  return data;
}

/** An object with own enumerable members, `__proto__` included (assignment would set the
 *  prototype instead). */
function toObject(entries: [string, unknown][]): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [key, value] of entries)
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return object;
}

export const styleArbitrary: fc.Arbitrary<Style> = fc.record({
  indent: fc.oneof(fc.constant<'\t'>('\t'), fc.integer({ min: 0, max: 8 })),
  eol: fc.constantFrom<Style['eol']>('\n', '\r\n'),
  finalNewline: fc.boolean(),
  quote: fc.constantFrom<Style['quote']>('"', "'"),
  unquotedKeys: fc.boolean(),
  trailingCommas: fc.boolean(),
});
