// Spec 011 criterion 2 (011 T2): every tag of criterion 2 has a case in each language (Lodash only
// for `chain-without-value`), every case is well formed, and the wizard cases hold the library's
// own `createQuery` text.
import { describe, expect, it } from 'vitest';
import {
  caseData,
  caseErrors,
  caseExpected,
  loadQueryCases,
  missingCells,
  wizardQuery,
  type QueryCase,
} from './query.js';

const cases = loadQueryCases();

/** Every value and key in data, depth first. */
function* walk(value: unknown): Generator<unknown> {
  yield value;
  if (value === null || typeof value !== 'object') return;
  for (const [key, member] of Object.entries(value)) {
    yield key;
    yield* walk(member);
  }
}

const hasValue = (data: unknown, test: (value: unknown) => boolean) => [...walk(data)].some(test);
const hasOwnProtoKey = (data: unknown) =>
  hasValue(data, (v) => v !== null && typeof v === 'object' && Object.hasOwn(v, '__proto__'));

/** What a Q2 tag says the expected data holds. */
const q2Facts: Partial<Record<string, (data: unknown) => boolean>> = {
  nan: (data) => hasValue(data, (v) => Number.isNaN(v)),
  infinity: (data) => hasValue(data, (v) => v === Infinity || v === -Infinity),
  'minus-zero': (data) => hasValue(data, (v) => Object.is(v, -0)),
  'proto-key': hasOwnProtoKey,
  'date-result': (data) =>
    hasValue(
      data,
      (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v),
    ),
};

describe('query corpus coverage (spec 011 criterion 2)', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('covers every tag of criterion 2 in each language', () => {
    expect(missingCells(cases)).toEqual([]);
  });

  it('tags every case with a known language and known, consistent tags', () => {
    const errors = cases.flatMap((c) => caseErrors(c).map((error) => `${c.name}: ${error}`));
    expect(errors).toEqual([]);
  });

  it.each(cases.filter((c) => c.meta.wizard).map((c) => [c.name, c] as const))(
    '%s: query.js is the library createQuery text',
    (_name, c) => {
      expect(c.query).toBe(wizardQuery(c));
    },
  );

  it.each(cases.map((c) => [c.name, c] as const))(
    '%s: input, path and expected parse',
    (_name, c) => {
      expect(() => caseData(c)).not.toThrow();
      if (c.expectedText !== undefined) expect(() => caseExpected(c)).not.toThrow();
    },
  );

  it.each(
    cases
      .filter((c) => c.expectedText !== undefined)
      .flatMap((c) =>
        c.meta.tags.flatMap((tag) => {
          const fact = q2Facts[tag];
          return fact ? [[c.name, tag, fact, c] as const] : [];
        }),
      ),
  )('%s: expected holds what its tag %s names', (_name, _tag, fact, c) => {
    expect(fact(caseExpected(c))).toBe(true);
  });

  it('keeps an own __proto__ key in the input of proto-key cases', () => {
    const lost = cases
      .filter((c) => c.meta.tags.includes('proto-key') && !hasOwnProtoKey(caseData(c)))
      .map((c) => c.name);
    expect(lost).toEqual([]);
  });
});

describe('query coverage helpers', () => {
  const make = (meta: object, result: { error?: string } = {}): QueryCase =>
    ({
      name: 'javascript-a',
      meta: { language: 'javascript', ...meta },
      inputText: '[]',
      query: 'function query (data) { return data }\n',
      expectedText: result.error === undefined ? '[]' : undefined,
      error: result.error,
    }) as QueryCase;

  it('accept a well-formed case', () => {
    expect(caseErrors(make({ tags: ['map'] }))).toEqual([]);
    expect(
      caseErrors(make({ tags: ['syntax-error'], engineMessage: true }, { error: 'x' })),
    ).toEqual([]);
    expect(
      caseErrors(
        make({ tags: ['filter'], wizard: { filter: { path: ['a'], relation: '==', value: '1' } } }),
      ),
    ).toEqual([]);
  });

  it('reject unknown, repeated, misplaced and missing tags', () => {
    expect(caseErrors(make({ tags: ['map', 'maps', 'map'], extra: 1 }))).toEqual([
      'unknown key "extra"',
      'unknown tag "maps"',
      '"tags" repeats a tag',
    ]);
    expect(caseErrors(make({ tags: [] }))).toEqual(['"tags" must be a non-empty list']);
    expect(caseErrors(make({ tags: ['chain-without-value'] }, { error: 'x' }))).toEqual([
      '"chain-without-value" is a Lodash tag',
    ]);
    expect(caseErrors(make({ language: 'lodash', tags: ['map'] }))).toEqual([
      'name must start with "lodash-"',
    ]);
  });

  it('tie error.json, path and wizard fields to their tags', () => {
    expect(caseErrors(make({ tags: ['map'] }, { error: 'x' }))).toEqual([
      'error.json needs exactly one of the tags syntax-error, thrown-error, missing-query, ' +
        'chain-without-value, bigint-result, cyclic-result',
    ]);
    expect(caseErrors(make({ tags: ['thrown-error'] }))).toEqual([
      'tag "thrown-error" needs error.json',
    ]);
    expect(
      caseErrors(make({ tags: ['thrown-error'], engineMessage: true }, { error: 'x' })),
    ).toEqual(['"engineMessage": true is only for syntax-error cases']);
    expect(caseErrors(make({ tags: ['map'], path: '/a' }))).toEqual([
      '"path" and the tag "nested-root" go together',
    ]);
    expect(caseErrors(make({ tags: ['sort'] }))).toEqual([
      'tag "sort" goes with the wizard field "sort"',
    ]);
    expect(caseErrors(make({ tags: ['map'], wizard: { projection: { paths: [['a']] } } }))).toEqual(
      ['tag "pick" goes with the wizard field "projection"'],
    );
  });

  it('list the cells no case covers', () => {
    expect(missingCells([make({ tags: ['map'] })])).toContain('filter in javascript');
    expect(missingCells([make({ tags: ['map'] })])).not.toContain('map in javascript');
    expect(missingCells([])).toContain('chain-without-value in lodash');
    expect(missingCells([])).not.toContain('chain-without-value in javascript');
  });
});
