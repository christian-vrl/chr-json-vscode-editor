// Spec 015 criterion 8 (015 T5): the library's JSONQuery, JMESPath and JSONPath (Goessner) on the
// big-number cases of the query corpus, each run as the Transform dialog runs it: spec 015 B7's
// wrapper around the library's own language, handed the editor's parser. Every case gives
// expected.json5, key order checked, big numbers as `LosslessNumber`s with their digits; or throws
// error.json's message (`big-ambiguous`: B7's "can't be kept exact", which the library's Transform
// dialog shows in its preview, with Transform disabled). RFC 9535 JSONPath's cases run in
// jsonpath-rfc9535.test.ts, through the same wrapper.
import { describe, expect, it } from 'vitest';
import { parserFor } from '../../packages/app-shell/src/parser.js';
import { exactNumbersLanguage } from '../../packages/app-shell/src/query/exact-numbers.js';
import {
  caseData,
  caseExpected,
  libraryLanguages,
  loadQueryCases,
  orderedEqual,
  type QueryCase,
} from './query.js';

const languages = ['jsonquery', 'jmespath', 'jsonpath'] as const;
const cases = loadQueryCases().filter((c) =>
  (languages as readonly string[]).includes(c.meta.language),
);

const run = (c: QueryCase) =>
  exactNumbersLanguage(libraryLanguages[c.meta.language]).executeQuery(
    caseData(c),
    c.query,
    parserFor('json5'),
  );

describe('library query languages keep big numbers exact (spec 015 criterion 8)', () => {
  it.each(languages)('%s has cases', (language) => {
    expect(cases.some((c) => c.meta.language === language)).toBe(true);
  });

  it.each(cases.filter((c) => c.error === undefined).map((c) => [c.name, c] as const))(
    '%s gives expected.json5',
    (_name, c) => {
      const result = run(c);
      expect(result).toEqual(caseExpected(c));
      expect(orderedEqual(result, caseExpected(c))).toBe(true);
    },
  );

  it.each(cases.filter((c) => c.error !== undefined).map((c) => [c.name, c] as const))(
    "%s throws error.json's message",
    (_name, c) => {
      expect(() => run(c)).toThrow(c.error);
    },
  );
});
