// Checks the hand-written conversion corpus (006 T1) against readings that do not depend on our
// format code (convert-reference.ts, `JSON.parse`, the json5 package), so a typo in an expected.* or
// losses.json fails before `convert` exists (006 T2 runs criterion 1 on the same cases):
// - input is valid in its source format and expected in its target (strict JSON for `json`);
// - data: expected holds the input's data, keys in the same order, except at each value loss's
//   path, where it holds `null` (C4, UNK-034; criterion 4);
// - losses: in input order, each one naming a whole comment or a non-finite number token there;
//   to `json` every comment is a loss, to `jsonc` and `json5` every comment is kept as written
//   (criterion 5); to `json` and `jsonc` every non-finite number is a loss;
// - superset pairs return the input unchanged with no losses (criterion 3);
// - case.json: `C4` and `C5` are tagged exactly when the case has value and comment losses, and
//   each loss sits in the case's `location`;
// - every string token and key is C1's or C2's rewrite of the input's: kept when it is a valid
//   RFC 8259 string literal, else `JSON.stringify` of its value; each rule tagged exactly when it
//   rewrites something;
// - every number token is C3's rewrite of the input's (hexadecimal to its exact decimal digits by
//   `BigInt`), and byte for byte the same in a case not tagged C3;
// - expected uses no line ending the input does not.
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { loadConvertCases, supersetPairs, type ConvertCase } from './convert.js';
import {
  codeIn,
  commentsIn,
  getAt,
  jsoncAsJson,
  keysAndStrings,
  locationAt,
  setAll,
} from './convert-reference.js';

const cases = loadConvertCases();

/** Reads a text the way its format allows, throwing on anything the format lacks. */
function read(text: string, format: string): unknown {
  if (format === 'json') return JSON.parse(text);
  if (format === 'jsonc') return JSON.parse(jsoncAsJson(text));
  return JSON5.parse(text);
}

/** Data with key order, so a reordered object differs (`toEqual` ignores key order). */
const ordered = (data: unknown) => JSON.stringify(data);

const nonFinite = /(?<![\w$])[+-]?(?:NaN|Infinity)(?![\w$])/g;

const number =
  /(?<![\w$.])[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?![\w$.])/g;

/** C3 written out: what a JSON5 number token becomes in JSON and JSONC. */
function c3(token: string): string {
  const hex = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(token);
  if (hex) return `${hex[1] === '-' ? '-' : ''}${BigInt(`0x${hex[2]}`)}`;
  return token
    .replace(/^\+/, '')
    .replace(/^(-?)\./, '$10.')
    .replace(/\.(?=[eE]|$)/, '');
}

/** C1 and C2 written out: a valid RFC 8259 string literal is kept, anything else becomes
 *  `JSON.stringify` of its value. */
function c1c2(token: { text: string; unquoted: boolean }): string {
  if (!token.unquoted && token.text.startsWith('"')) {
    try {
      JSON.parse(token.text);
      return token.text;
    } catch {
      // Not valid JSON: rewritten below.
    }
  }
  const value = token.unquoted
    ? Object.keys(JSON5.parse<object>(`{${token.text}: 0}`))[0]
    : JSON5.parse<string>(token.text);
  return JSON.stringify(value);
}

const eols = (text: string) => new Set(text.match(/\r\n|\r|\n/g) ?? []);

describe.each(cases.map((c) => [`${c.pair}/${c.name}`, c] as const))('%s', (_, c: ConvertCase) => {
  const valueLosses = c.losses.filter((l) => l.kind === 'value');
  const commentLosses = c.losses.filter((l) => l.kind === 'comment');
  const slice = (l: { offset: number; length: number }) =>
    c.input.slice(l.offset, l.offset + l.length);

  it(`input is ${c.from} and expected is ${c.to}`, () => {
    expect(() => read(c.input, c.from)).not.toThrow();
    expect(() => read(c.expected, c.to)).not.toThrow();
  });

  it('expected holds the input data, with null at each value loss (C4, UNK-034)', () => {
    const want = setAll(
      JSON5.parse(c.input),
      valueLosses.map((l) => l.path!),
      null,
    );
    const got = read(c.expected, c.to);
    expect(got).toEqual(want);
    expect(ordered(got)).toBe(ordered(want));
  });

  if (supersetPairs.includes(c.pair)) {
    it('a superset pair returns the input unchanged with no loss (criterion 3)', () => {
      expect(c.expected).toBe(c.input);
      expect(c.losses).toEqual([]);
      expect(c.tags.rules).toEqual(['C7']);
    });
  } else {
    it('the case rewrites something', () => {
      expect(c.expected).not.toBe(c.input);
    });
  }

  it('losses are in input order and do not overlap', () => {
    for (let i = 1; i < c.losses.length; i++) {
      const before = c.losses[i - 1]!;
      expect(c.losses[i]!.offset).toBeGreaterThanOrEqual(before.offset + before.length);
    }
    for (const l of c.losses) expect(l.offset + l.length).toBeLessThanOrEqual(c.input.length);
  });

  it('comment losses are exactly the input comments to json; other targets keep them (C5)', () => {
    const comments = commentsIn(c.input, c.from);
    if (c.to === 'json') {
      expect(commentLosses.map(slice)).toEqual(comments);
    } else {
      expect(commentLosses).toEqual([]);
      expect(commentsIn(c.expected, c.to)).toEqual(comments);
    }
  });

  it('value losses are exactly the non-finite number tokens to json and jsonc (C4)', () => {
    const tokens = codeIn(c.input, c.from).match(nonFinite) ?? [];
    if (c.to === 'json5') {
      expect(valueLosses).toEqual([]);
    } else {
      expect(valueLosses.map(slice)).toEqual(tokens);
    }
    const data = JSON5.parse<unknown>(c.input);
    for (const l of valueLosses) {
      expect(slice(l)).toMatch(/^[+-]?(?:NaN|Infinity)$/);
      expect(Number.isFinite(getAt(data, l.path!))).toBe(false);
      expect(getAt(data, l.path!)).toBeTypeOf('number');
    }
  });

  it('case.json tags C4 and C5 exactly when the case loses values and comments', () => {
    expect(c.tags.rules.includes('C4')).toBe(valueLosses.length > 0);
    expect(c.tags.rules.includes('C5')).toBe(commentLosses.length > 0);
  });

  it("each loss is in the case's location", () => {
    for (const l of c.losses) expect(locationAt(c.input, c.from, l.offset)).toBe(c.tags.location);
  });

  it('strings and keys are rewritten by C1 and C2 only, as their JSON.stringify', () => {
    const before = keysAndStrings(c.input, c.from);
    const after = keysAndStrings(c.expected, c.to);
    const rewrite = c.to === 'json5' ? (t: { text: string }) => t.text : c1c2;
    expect(after.map((t) => t.text)).toEqual(before.map(rewrite));
    const changed = (isKey: boolean) =>
      before.some((t) => t.isKey === isKey && rewrite(t) !== t.text);
    expect(c.tags.rules.includes('C1')).toBe(changed(false));
    expect(c.tags.rules.includes('C2')).toBe(changed(true));
  });

  it('number tokens are rewritten by C3 only, without a digit changing', () => {
    const before = codeIn(c.input, c.from).match(number) ?? [];
    const after = codeIn(c.expected, c.to).match(number) ?? [];
    const rewrite = c.to === 'json5' ? (t: string) => t : c3;
    expect(after).toEqual(before.map(rewrite));
    expect(c.tags.rules.includes('C3')).toBe(before.some((t) => rewrite(t) !== t));
  });

  it('expected uses no line ending the input lacks', () => {
    const input = eols(c.input);
    for (const eol of eols(c.expected)) expect(input.has(eol)).toBe(true);
  });
});
