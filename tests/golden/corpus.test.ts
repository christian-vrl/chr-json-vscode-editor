// Checks the hand-written golden bytes against references that do not depend on our format code
// (002 T1), so a typo in an expected.* file fails here before any adapter exists:
// - data: parsing expected gives the data `immutable-json-patch` produces from the input's data
//   (spec 002 criterion 2); a `test-fail` case's patch must throw and leave the bytes unchanged (R9);
// - R10: expected keeps the input's line endings and final newline (R15's exception aside);
// - strict JSON stays strict JSON (R6, R4);
// - the case.json tags describe the input and patch (facts.ts);
// - whole-document actions (R12, R13): `compact` keeps the data and its key order, `sort` gives the
//   data the library's sort gives (sort-reference.ts), and both keep every comment.
// JSON5.parse reads all three formats as data: JSONC's comments and trailing commas are JSON5.
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { commentsOf, parseData, tagMismatches } from './facts.js';
import { selectGoldenCases } from './filter.js';
import { loadGoldenCases } from './load.js';
import { sortData, type SortAction } from './sort-reference.js';

const cases = selectGoldenCases(loadGoldenCases());

/** Data with key order, so a reordered object differs (`toEqual` ignores key order). */
const ordered = (data: unknown) => JSON.stringify(data);

/** A comment as R12 writes it on a shared line: a `//` comment becomes a block comment. */
const asBlock = (comment: string) =>
  comment.startsWith('//') ? `/*${comment.slice(2).replace(/\*\//g, '*\\/')} */` : comment;

const eols = (text: string) => ({
  crlf: (text.match(/\r\n/g) ?? []).length > 0,
  bareLf: /(^|[^\r])\n/.test(text),
  finalNewline: text.endsWith('\n'),
});

describe.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))('%s', (_, c) => {
  const patch = c.patch as JSONPatchDocument;

  if (c.tags.op === 'compact') {
    it('expected has the input data, keys in the same order, and every comment (R12)', () => {
      expect(ordered(JSON5.parse(c.expected))).toBe(ordered(parseData(c.input)));
      expect(commentsOf(c.expected)).toEqual(commentsOf(c.input).map(asBlock));
    });
  } else if (c.tags.op === 'sort') {
    it("expected has the library's sorted data and every comment (R13)", () => {
      const action = c.patch[0] as unknown as SortAction;
      expect(ordered(JSON5.parse(c.expected))).toBe(ordered(sortData(parseData(c.input), action)));
      // A `//` comment may become a block comment where it no longer ends its line (R13, R12).
      const comments = (text: string) => commentsOf(text).map(asBlock).sort();
      expect(comments(c.expected)).toEqual(comments(c.input));
    });
  } else if (c.tags.op === 'test-fail') {
    it('has a patch that fails and an unchanged expected (R9)', () => {
      expect(() => immutableJSONPatch(parseData(c.input), patch)).toThrow();
      expect(c.expected).toBe(c.input);
    });
  } else {
    it('expected data equals the reference patch applied to the input data', () => {
      expect(JSON5.parse(c.expected)).toEqual(immutableJSONPatch(parseData(c.input), patch));
    });
  }

  it('has tags that match its input and patch', () => {
    expect(tagMismatches(c)).toEqual([]);
  });

  if (c.tags.op === 'compact') {
    it('has no line break outside tokens, and keeps the final newline (R12, R10)', () => {
      const body = c.expected.replace(/\r?\n$/, '');
      expect(c.expected.slice(body.length)).toBe(/\r?\n$/.exec(c.input)?.[0] ?? '');
      // Line breaks left in the body are inside a string or a block comment.
      expect(
        body.replace(/\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"/g, ''),
      ).not.toMatch(/[\r\n]/);
    });
  } else if (
    c.tags.location === 'document' &&
    !/[\r\n]/.test(c.input) &&
    c.tags.op !== 'test-fail'
  ) {
    it('writes \\n line endings and a final newline into a text with no line break (R15)', () => {
      expect(eols(c.expected)).toEqual({ crlf: false, bareLf: true, finalNewline: true });
    });
  } else {
    it('keeps line endings and the final newline (R10)', () => {
      expect(eols(c.expected)).toEqual(eols(c.input));
    });
  }

  if (c.format === 'json') {
    it('input and expected are strict JSON', () => {
      if (parseData(c.input) !== undefined)
        expect(() => JSON.parse(c.input) as unknown).not.toThrow();
      expect(() => JSON.parse(c.expected) as unknown).not.toThrow();
    });
  }
});
