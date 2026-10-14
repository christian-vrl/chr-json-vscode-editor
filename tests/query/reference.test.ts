// Spec 011 criterion 1, reference half (011 T2): for every case without error.json and without a
// Q2 tag, the library's own `executeQuery` gives expected.json5's data, key order checked. Error
// cases without a Q2 tag make the reference throw too, with error.json's text unless the case says
// the text is the engine's own wording. The engine half (`runQuery`) is 011 T3's.
//
// JSONPath (RFC 9535) cases (014 T1) have no reference engine here (jsonpath-rfc9535.test.ts runs the engine); two
// checks tie them to the library's JSONPath (Goessner): each wizard case gives the same data there
// (014 P7: the wizard text means the same in both), and each `goessner-only` query runs there.
import { describe, expect, it } from 'vitest';
import {
  caseData,
  caseExpected,
  goessnerQuery,
  hasBigTag,
  hasQ2Tag,
  isRfc9535Case,
  loadQueryCases,
  orderedEqual,
  pointerGet,
  quickJsCases,
  referenceQuery,
} from './query.js';

const all = loadQueryCases();
// Big-number cases (spec 015) are left out too: the reference runs on rounded numbers.
const cases = quickJsCases(all).filter((c) => !hasQ2Tag(c) && !hasBigTag(c));
const rfc9535 = all.filter(isRfc9535Case);

describe('query corpus against the reference (spec 011 criterion 1)', () => {
  it.each(cases.filter((c) => c.error === undefined).map((c) => [c.name, c] as const))(
    '%s: the reference gives expected',
    (_name, c) => {
      const result = referenceQuery(c.meta.language, caseData(c), c.query);
      expect(result).toEqual(caseExpected(c));
      expect(orderedEqual(result, caseExpected(c))).toBe(true);
    },
  );

  it.each(cases.filter((c) => c.error !== undefined).map((c) => [c.name, c] as const))(
    '%s: the reference throws',
    (_name, c) => {
      expect(() => referenceQuery(c.meta.language, caseData(c), c.query)).toThrow(
        c.meta.engineMessage ? undefined : c.error,
      );
    },
  );
});

describe('JSONPath (RFC 9535) corpus against JSONPath (Goessner) (spec 014 P7)', () => {
  it.each(
    rfc9535
      .filter((c) => c.meta.wizard !== undefined && c.error === undefined)
      .map((c) => [c.name, c] as const),
  )('%s: the wizard text gives expected in Goessner too', (_name, c) => {
    const result = goessnerQuery(caseData(c), c.query);
    expect(orderedEqual(result, caseExpected(c))).toBe(true);
  });

  it.each(
    rfc9535.filter((c) => c.meta.tags.includes('goessner-only')).map((c) => [c.name, c] as const),
  )('%s: Goessner accepts the query', (_name, c) => {
    expect(() => goessnerQuery(caseData(c), c.query)).not.toThrow();
  });
});

describe('query corpus helpers', () => {
  it('orderedEqual checks key order, -0 and NaN', () => {
    expect(orderedEqual({ a: 1, b: [2, { c: 3 }] }, { a: 1, b: [2, { c: 3 }] })).toBe(true);
    expect(orderedEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(orderedEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(false);
    expect(orderedEqual(-0, 0)).toBe(false);
    expect(orderedEqual(NaN, NaN)).toBe(true);
    expect(orderedEqual(null, null)).toBe(true);
  });

  it('pointerGet reads RFC 6901 pointers and throws when the node is not there', () => {
    const data = { 'a/b': { '~c': [10, 20] } };
    expect(pointerGet(data, '')).toBe(data);
    expect(pointerGet(data, '/a~1b/~0c/1')).toBe(20);
    expect(() => pointerGet(data, '/x')).toThrow('"/x" is not in the input');
    expect(() => pointerGet(data, 'a')).toThrow('is not a JSON Pointer');
  });
});
