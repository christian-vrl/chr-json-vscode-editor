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
// The JSON Lines pairs (spec 012, 012 T1) take the same checks, JSON Lines read as jsonl-reference.ts
// reads it and treated as `json` for C1–C5; J1's layout is checked against `j1`, J2's lines are each
// one item written compact (002 R12) and ended by the source's line ending (`\n` when it has none).
// Error cases (error.json) are a JSON Lines source with a bad line, or a source to JSON Lines whose
// root is not an array (spec 012 criterion 9).
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { jsonlPairs, loadConvertCases, supersetPairs, type ConvertCase } from './convert.js';
import {
  codeIn,
  commentsIn,
  getAt,
  jsoncAsJson,
  keysAndStrings,
  locationAt,
  setAll,
} from './convert-reference.js';
import { compactJson, j1, jsonlStyle, readJsonl, splitLines } from './jsonl-reference.js';

const all = loadConvertCases();
const cases = all.filter((c) => !c.error);
const errorCases = all.filter((c) => c.error);

/** Reads a JSON Lines text as its array of items, throwing on a bad line. */
function readLines(text: string): unknown[] {
  const reading = readJsonl(text);
  if (reading.bad.length > 0) throw new SyntaxError(`line ${reading.bad[0]} is bad`);
  return reading.items;
}

/** Reads a text the way its format allows, throwing on anything the format lacks. */
function read(text: string, format: string): unknown {
  if (format === 'jsonl') return readLines(text);
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

/** The source's data: JSON Lines as its items, anything else as JSON5 reads it. */
const sourceData = (c: ConvertCase): unknown =>
  c.from === 'jsonl' ? readLines(c.input) : JSON5.parse(c.input);

/** A target that is strict JSON per value: comments and non-finite numbers are losses. */
const strictTarget = (c: ConvertCase) => c.to === 'json' || c.to === 'jsonl';

describe.each(cases.map((c) => [`${c.pair}/${c.name}`, c] as const))('%s', (_, c: ConvertCase) => {
  const losses = c.losses!;
  const expected = c.expected!;
  const valueLosses = losses.filter((l) => l.kind === 'value');
  const commentLosses = losses.filter((l) => l.kind === 'comment');
  const slice = (l: { offset: number; length: number }) =>
    c.input.slice(l.offset, l.offset + l.length);

  it(`input is ${c.from} and expected is ${c.to}`, () => {
    expect(() => read(c.input, c.from)).not.toThrow();
    expect(() => read(expected, c.to)).not.toThrow();
  });

  it('expected holds the input data, with null at each value loss (C4, UNK-034)', () => {
    const want = setAll(
      sourceData(c),
      valueLosses.map((l) => l.path!),
      null,
    );
    const got = read(expected, c.to);
    expect(got).toEqual(want);
    expect(ordered(got)).toBe(ordered(want));
  });

  if (supersetPairs.includes(c.pair)) {
    it('a superset pair returns the input unchanged with no loss (criterion 3)', () => {
      expect(expected).toBe(c.input);
      expect(losses).toEqual([]);
      expect(c.tags.rules).toEqual(['C7']);
    });
  } else {
    it('the case rewrites something', () => {
      expect(expected).not.toBe(c.input);
    });
  }

  it('losses are in input order and do not overlap', () => {
    for (let i = 1; i < losses.length; i++) {
      const before = losses[i - 1]!;
      expect(losses[i]!.offset).toBeGreaterThanOrEqual(before.offset + before.length);
    }
    for (const l of losses) expect(l.offset + l.length).toBeLessThanOrEqual(c.input.length);
  });

  it('comment losses are exactly the input comments to json; other targets keep them (C5)', () => {
    const comments = commentsIn(c.input, c.from);
    if (strictTarget(c)) {
      expect(commentLosses.map(slice)).toEqual(comments);
    } else {
      expect(commentLosses).toEqual([]);
      expect(commentsIn(expected, c.to)).toEqual(comments);
    }
  });

  it('value losses are exactly the non-finite number tokens to json and jsonc (C4)', () => {
    const tokens = codeIn(c.input, c.from).match(nonFinite) ?? [];
    if (c.to === 'json5') {
      expect(valueLosses).toEqual([]);
    } else {
      expect(valueLosses.map(slice)).toEqual(tokens);
    }
    const data = sourceData(c);
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
    for (const l of losses) expect(locationAt(c.input, c.from, l.offset)).toBe(c.tags.location);
  });

  it('strings and keys are rewritten by C1 and C2 only, as their JSON.stringify', () => {
    const before = keysAndStrings(c.input, c.from);
    const after = keysAndStrings(expected, c.to);
    const rewrite = c.to === 'json5' ? (t: { text: string }) => t.text : c1c2;
    expect(after.map((t) => t.text)).toEqual(before.map(rewrite));
    const changed = (isKey: boolean) =>
      before.some((t) => t.isKey === isKey && rewrite(t) !== t.text);
    expect(c.tags.rules.includes('C1')).toBe(changed(false));
    expect(c.tags.rules.includes('C2')).toBe(changed(true));
  });

  it('number tokens are rewritten by C3 only, without a digit changing', () => {
    const before = codeIn(c.input, c.from).match(number) ?? [];
    const after = codeIn(expected, c.to).match(number) ?? [];
    const rewrite = c.to === 'json5' ? (t: string) => t : c3;
    expect(after).toEqual(before.map(rewrite));
    expect(c.tags.rules.includes('C3')).toBe(before.some((t) => rewrite(t) !== t));
  });

  it('expected uses no line ending the input lacks', () => {
    const input = eols(c.input);
    // J1 and J2 write `\n` for a source with no line ending (L2).
    if (input.size === 0 && jsonlPairs.includes(c.pair)) input.add('\n');
    for (const eol of eols(expected)) expect(input.has(eol)).toBe(true);
  });

  if (c.from === 'jsonl') {
    it('is J1 of the input: the item bytes in an array, two spaces in', () => {
      expect(expected).toBe(j1(c.input));
    });
  }

  if (c.to === 'jsonl') {
    it("is J2: one compact item per line, each ended by the source's line ending", () => {
      const lines = splitLines(expected);
      const items = read(expected, 'jsonl') as unknown[];
      expect(lines).toHaveLength(items.length);
      const { eol } = jsonlStyle(c.input);
      for (const line of lines) {
        expect(line.ending).toBe(eol);
        expect(compactJson(line.content)).toBe(line.content);
      }
    });
  }
});

describe.each(errorCases.map((c) => [`${c.pair}/${c.name}`, c] as const))('%s', (_, c) => {
  if (c.from === 'jsonl') {
    it('the JSON Lines source has a bad line, which the message names (criterion 9)', () => {
      const { bad } = readJsonl(c.input);
      expect(bad.length).toBeGreaterThan(0);
      expect(c.error!.message).toBe(`Line ${bad[0]} is not valid JSON.`);
    });
  } else {
    it('the source reads in its format and its root is not an array (criterion 9, J2)', () => {
      expect(c.to).toBe('jsonl');
      expect(Array.isArray(read(c.input, c.from))).toBe(false);
      expect(c.error!.message).toBe('JSON Lines needs an array at the root.');
    });
  }
});
