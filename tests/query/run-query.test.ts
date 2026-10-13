// Spec 011 criterion 1, engine half (011 T3): `runQuery` gives every case's expected.json5, key order
// and `-0` checked, or a QueryError whose message contains error.json's text. The reference half is
// reference.test.ts (011 T2). JSONPath (RFC 9535) cases (spec 014) are not runQuery's and are left out.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  loadQueryEngine,
  QueryError,
  runQuery,
} from '../../packages/app-shell/src/query/run-query.js';
import { caseData, caseExpected, loadQueryCases, orderedEqual, quickJsCases } from './query.js';

const cases = quickJsCases(loadQueryCases());

beforeAll(() => loadQueryEngine(() => import('../../packages/app-shell/src/query/engine.js')));

describe('query corpus in the engine (spec 011 criterion 1)', () => {
  it.each(cases.filter((c) => c.error === undefined).map((c) => [c.name, c] as const))(
    '%s: runQuery gives expected',
    (_name, c) => {
      const result = runQuery(c.meta.language, caseData(c), c.query);
      expect(result).toEqual(caseExpected(c));
      expect(orderedEqual(result, caseExpected(c))).toBe(true);
    },
  );

  it.each(cases.filter((c) => c.error !== undefined).map((c) => [c.name, c] as const))(
    '%s: runQuery throws a QueryError with error.json',
    (_name, c) => {
      let thrown: unknown;
      try {
        runQuery(c.meta.language, caseData(c), c.query);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(QueryError);
      expect((thrown as QueryError).message).toContain(c.error);
    },
  );
});
