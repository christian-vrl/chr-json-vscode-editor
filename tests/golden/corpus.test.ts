// Checks the hand-written golden bytes against references that do not depend on our format code
// (002 T1), so a typo in an expected.* file fails here before any adapter exists:
// - data: parsing expected gives the data `immutable-json-patch` produces from the input's data
//   (spec 002 criterion 2); a `test-fail` case's patch must throw and leave the bytes unchanged (R9);
// - R10: expected keeps the input's line endings and final newline;
// - strict JSON stays strict JSON (R6, R4);
// - the case.json tags describe the input and patch (facts.ts).
// JSON5.parse reads all three formats as data: JSONC's comments and trailing commas are JSON5.
import { immutableJSONPatch, type JSONPatchDocument } from 'immutable-json-patch';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { tagMismatches } from './facts.js';
import { selectGoldenCases } from './filter.js';
import { loadGoldenCases } from './load.js';

const cases = selectGoldenCases(loadGoldenCases());

const eols = (text: string) => ({
  crlf: (text.match(/\r\n/g) ?? []).length > 0,
  bareLf: /(^|[^\r])\n/.test(text),
  finalNewline: text.endsWith('\n'),
});

describe.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))('%s', (_, c) => {
  const patch = c.patch as JSONPatchDocument;

  if (c.tags.op === 'test-fail') {
    it('has a patch that fails and an unchanged expected (R9)', () => {
      expect(() => immutableJSONPatch(JSON5.parse(c.input), patch)).toThrow();
      expect(c.expected).toBe(c.input);
    });
  } else {
    it('expected data equals the reference patch applied to the input data', () => {
      expect(JSON5.parse(c.expected)).toEqual(immutableJSONPatch(JSON5.parse(c.input), patch));
    });
  }

  it('has tags that match its input and patch', () => {
    expect(tagMismatches(c)).toEqual([]);
  });

  it('keeps line endings and the final newline (R10)', () => {
    expect(eols(c.expected)).toEqual(eols(c.input));
  });

  if (c.format === 'json') {
    it('input and expected are strict JSON', () => {
      expect(() => JSON.parse(c.input) as unknown).not.toThrow();
      expect(() => JSON.parse(c.expected) as unknown).not.toThrow();
    });
  }
});
