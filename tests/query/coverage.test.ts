// Spec 011 criterion 2 (011 T2): every tag of criterion 2 has a case in each language (Lodash only
// for `chain-without-value`), every case is well formed, and the wizard cases hold the library's
// own `createQuery` text.
//
// Spec 014 criterion 3 (014 T1): the same test covers the JSONPath (RFC 9535) cases: every tag of
// criterion 3 has a case, each wizard case's query.jsonpath is the library's JSONPath `createQuery`
// text, and each refused wizard case's error.json is the message `createQuery` throws (P7).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  caseData,
  caseErrors,
  caseExpected,
  loadQueryCases,
  missingCells,
  refusedTags,
  wizardQuery,
  wizardRefusal,
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

/** How many arrays and objects deep the data nests (a scalar: 0), without recursion. */
function depth(data: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[data, 0]];
  while (stack.length > 0) {
    const [value, level] = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    max = Math.max(max, level + 1);
    for (const member of Object.values(value)) stack.push([member, level + 1]);
  }
  return max;
}
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

  const refused = (c: QueryCase) => c.meta.tags.some((tag) => refusedTags.includes(tag));

  it.each(cases.filter((c) => c.meta.wizard && !refused(c)).map((c) => [c.name, c] as const))(
    '%s: the query is the library createQuery text',
    (_name, c) => {
      expect(c.query).toBe(wizardQuery(c));
    },
  );

  it.each(cases.filter(refused).map((c) => [c.name, c] as const))(
    "%s: error.json is the library createQuery's refusal",
    (_name, c) => {
      expect(wizardRefusal(c)).toBe(c.error);
    },
  );

  it.each(
    cases.filter((c) => c.meta.tags.includes('bracket-name')).map((c) => [c.name, c] as const),
  )('%s: the query has a bracketed name selector', (_name, c) => {
    expect(c.query).toMatch(/\[\s*["']/);
  });

  it('nests deep inputs past the engine default (50) and too-deep ones past P6 (1,000)', () => {
    const wrong = cases.flatMap((c) => {
      const levels = c.meta.tags.some((tag) => tag === 'deep' || tag === 'too-deep')
        ? depth(caseData(c))
        : 0;
      if (c.meta.tags.includes('deep') && !(levels > 50 && levels < 1000)) return [c.name];
      if (c.meta.tags.includes('too-deep') && !(levels > 1000)) return [c.name];
      return [];
    });
    expect(wrong).toEqual([]);
  });

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
    ).toEqual(['"engineMessage": true is only for JavaScript and Lodash syntax-error cases']);
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

  const rfc = (meta: object, result: { error?: string } = {}): QueryCase => ({
    ...make({ language: 'jsonpath-rfc9535', ...meta }, result),
    name: 'jsonpath-rfc9535-a',
    query: '$',
  });

  it('keep each language to its own tags', () => {
    expect(caseErrors(rfc({ tags: ['child'] }))).toEqual([]);
    expect(caseErrors(rfc({ tags: ['map'] }))).toEqual(['tag "map" is not a jsonpath-rfc9535 tag']);
    expect(caseErrors(make({ tags: ['child'] }))).toEqual(['tag "child" is not a javascript tag']);
    expect(caseErrors(rfc({ tags: ['child'] }, { error: 'x' }))).toEqual([
      'error.json needs exactly one of the tags syntax-error, sort-refused, multi-pick-refused, ' +
        'type-error, unknown-function, too-deep, goessner-only',
    ]);
    expect(
      caseErrors(rfc({ tags: ['syntax-error'], engineMessage: true }, { error: 'x' })),
    ).toEqual(['"engineMessage": true is only for JavaScript and Lodash syntax-error cases']);
  });

  it('tie JSONPath (RFC 9535) wizard fields to filter, pick and the refused tags', () => {
    const filter = { filter: { path: ['a'], relation: '==', value: '1' } };
    const sort = { sort: { path: ['a'], direction: 'asc' } };
    expect(caseErrors(rfc({ tags: ['filter'], wizard: filter }))).toEqual([]);
    expect(caseErrors(rfc({ tags: ['pick'], wizard: { projection: { paths: [['a']] } } }))).toEqual(
      [],
    );
    expect(
      caseErrors(
        rfc(
          { tags: ['multi-pick-refused'], wizard: { projection: { paths: [['a'], ['b']] } } },
          {
            error: 'x',
          },
        ),
      ),
    ).toEqual([]);
    expect(caseErrors(rfc({ tags: ['sort-refused'], wizard: sort }, { error: 'x' }))).toEqual([]);
    expect(
      caseErrors(rfc({ tags: ['pick'], wizard: { projection: { paths: [['a'], ['b']] } } })),
    ).toEqual([
      'tag "pick" goes with a wizard "projection" of one path',
      'tag "multi-pick-refused" goes with a wizard "projection" of two or more paths',
    ]);
    expect(caseErrors(rfc({ tags: ['filter'], wizard: sort }))).toEqual([
      'tag "filter" goes with the wizard field "filter"',
      'tag "sort-refused" goes with the wizard field "sort"',
    ]);
  });

  it('list the cells no case covers', () => {
    expect(missingCells([make({ tags: ['map'] })])).toContain('filter in javascript');
    expect(missingCells([make({ tags: ['map'] })])).not.toContain('map in javascript');
    expect(missingCells([])).toContain('chain-without-value in lodash');
    expect(missingCells([])).not.toContain('chain-without-value in javascript');
    expect(missingCells([])).toContain('goessner-only in jsonpath-rfc9535');
    expect(missingCells([rfc({ tags: ['child'] })])).not.toContain('child in jsonpath-rfc9535');
    expect(missingCells([])).not.toContain('sort in jsonpath-rfc9535');
  });
});

describe('query loader (spec 014 T1)', () => {
  /** Writes one case folder under a fresh root and loads it. */
  function load(files: Record<string, string>): QueryCase[] {
    const root = mkdtempSync(path.join(tmpdir(), 'query-cases-'));
    try {
      const dir = path.join(root, 'jsonpath-rfc9535-a');
      mkdirSync(dir);
      for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
      return loadQueryCases(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const meta = (tags: string[]) => JSON.stringify({ language: 'jsonpath-rfc9535', tags });

  it('reads query.jsonpath without its one final newline', () => {
    const [c] = load({
      'case.json': meta(['child']),
      'input.json5': '{ a: 1 }',
      'query.jsonpath': '$.a\n',
      'expected.json5': '[1]',
    });
    expect(c?.query).toBe('$.a');
  });

  it('rejects query.jsonpath without exactly one final newline', () => {
    for (const query of ['$.a', '$.a\n\n', '$.a \n']) {
      expect(() =>
        load({
          'case.json': meta(['child']),
          'input.json5': '{ a: 1 }',
          'query.jsonpath': query,
          'expected.json5': '[1]',
        }),
      ).toThrow('must end with exactly one newline');
    }
  });

  it('wants query.jsonpath, not query.js, and none in a refused wizard case', () => {
    expect(() =>
      load({
        'case.json': meta(['child']),
        'input.json5': '{}',
        'query.js': '$\n',
        'expected.json5': '[]',
      }),
    ).toThrow('needs case.json, input.json5, query.jsonpath');
    expect(() =>
      load({
        'case.json': meta(['sort-refused']),
        'input.json5': '[]',
        'query.jsonpath': '$\n',
        'error.json': '{ "message": "x" }',
      }),
    ).toThrow('needs case.json, input.json5 and one of');
    const [c] = load({
      'case.json': meta(['sort-refused']),
      'input.json5': '[]',
      'error.json': '{ "message": "x" }',
    });
    expect(c?.query).toBe('');
  });
});
