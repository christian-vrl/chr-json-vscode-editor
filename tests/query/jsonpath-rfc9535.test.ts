// Spec 014 criteria 1 and 2 (014 T2): JSONPath (RFC 9535) against the vendored compliance test suite
// and the hand-written corpus.
//
// Criterion 1: every CTS test with a selector and a document gives exactly its `result` (or one of
// its `results`), `isDeepStrictEqual` and key order checked; every `invalid_selector` test throws.
// None is skipped. Criterion 2: every tests/query/jsonpath-rfc9535-<case>/ gives expected.json5, key
// order checked, or an error whose message contains error.json's text. A refused wizard case (P7)
// has no query: the language's `createQuery` throws the library's message instead. The corpus runs
// through spec 015 B7's wrapper, as the Transform dialog runs the language (its big-number cases are
// spec 015 criterion 8's); the suite's documents hold no big number.
import { describe, expect, it } from 'vitest';
import { exactNumbersLanguage } from '../../packages/app-shell/src/query/exact-numbers.js';
import { jsonpathRfc9535QueryLanguage } from '../../packages/app-shell/src/query/jsonpath-rfc9535.js';
import { parserFor } from '../../packages/app-shell/src/parser.js';
import {
  caseData,
  caseExpected,
  isRfc9535Case,
  loadCtsTests,
  loadQueryCases,
  orderedEqual,
  refusedTags,
} from './query.js';

const { createQuery, executeQuery } = jsonpathRfc9535QueryLanguage;
const run = (data: unknown, query: string) => executeQuery(data, query, JSON);
const exact = exactNumbersLanguage(jsonpathRfc9535QueryLanguage);
/** As the Transform dialog of a JSON5 document runs it (the library hands it the editor's parser). */
const runExact = (data: unknown, query: string) =>
  exact.executeQuery(data, query, parserFor('json5'));

/** The error a call throws, or undefined when it returns. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('JSONPath (RFC 9535) on the compliance test suite (spec 014 criterion 1)', () => {
  const tests = loadCtsTests();

  it('runs all 706 tests', () => {
    expect(tests).toHaveLength(706);
  });

  it.each(tests.filter((t) => t.invalid_selector !== true).map((t) => [t.name, t] as const))(
    '%s',
    (_name, t) => {
      const result = run(t.document, t.selector);
      const allowed = t.results ?? [t.result];
      expect(allowed.some((expected) => orderedEqual(result, expected))).toBe(true);
    },
  );

  it.each(tests.filter((t) => t.invalid_selector === true).map((t) => [t.name, t] as const))(
    '%s (invalid selector)',
    (_name, t) => {
      expect(thrownBy(() => run({}, t.selector))).toBeInstanceOf(Error);
    },
  );
});

describe('JSONPath (RFC 9535) on the query corpus (spec 014 criterion 2)', () => {
  const cases = loadQueryCases().filter(isRfc9535Case);
  const refused = cases.filter((c) => c.meta.tags.some((tag) => refusedTags.includes(tag)));
  const queried = cases.filter((c) => !refused.includes(c));

  it('has cases', () => {
    expect(queried.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
  });

  it.each(queried.filter((c) => c.error === undefined).map((c) => [c.name, c] as const))(
    '%s gives expected.json5',
    (_name, c) => {
      const result = runExact(caseData(c), c.query);
      expect(result).toEqual(caseExpected(c));
      expect(orderedEqual(result, caseExpected(c))).toBe(true);
    },
  );

  it.each(queried.filter((c) => c.error !== undefined).map((c) => [c.name, c] as const))(
    "%s throws error.json's message",
    (_name, c) => {
      const error = thrownBy(() => runExact(caseData(c), c.query));
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(c.error);
    },
  );

  it.each(refused.map((c) => [c.name, c] as const))(
    "%s: createQuery throws error.json's message",
    (_name, c) => {
      const error = thrownBy(() => createQuery(caseData(c), c.meta.wizard!));
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(c.error);
    },
  );
});
