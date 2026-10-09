// 002 T10: comment-keeping compact (spec 002 R12) and sort (R13); 003 T8: format (`prettyPrint`) and
// sort by a given order. Unit cases for details the golden corpus does not show, and a property
// test for criterion 8's second half (and spec 003 criterion 10 for format) over random commented
// documents: the data is kept (compact, format) or sorted as `vanilla-jsoneditor` sorts it (sort),
// the output parses, and every input comment is in the output (no action removes a member).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sortData } from '../../../tests/golden/sort-reference.js';
import { getAdapter, PatchError, type Format, type SortOptions } from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { printDocument } from './print-document.js';

const formats = ['json', 'jsonc', 'json5'] as const;
const RUNS = 2_000;

describe('compact (R12)', () => {
  const jsonc = getAdapter('jsonc');

  it('keeps a document with comments only, and the empty document', () => {
    expect(jsonc.compact('// a\n/* b */\n')).toBe('/* a *//* b */\n');
    expect(jsonc.compact('')).toBe('');
  });

  it('keeps the line break inside a block comment', () => {
    expect(jsonc.compact('[1, /* x\n y */ 2]')).toBe('[1,/* x\n y */2]');
  });

  it('writes an empty line comment as an empty block comment', () => {
    expect(jsonc.compact('[1 //\n]')).toBe('[1/* */]');
  });

  it('removes white space that is not a line break, such as a JSON5 non-breaking space', () => {
    expect(getAdapter('json5').compact('{\u00a0a:\u20281}')).toBe('{a:1}');
  });

  it('throws a PatchError for a text that does not parse', () => {
    for (const format of formats)
      expect(() => getAdapter(format).compact('{"a": }')).toThrow(PatchError);
  });
});

describe('sort (R13)', () => {
  const jsonc = getAdapter('jsonc');

  it('returns the text unchanged when it is already sorted', () => {
    const text = '{\n  "a": 1 ,\n  "b": 2\n}\n';
    expect(jsonc.sort(text)).toBe(text);
    expect(jsonc.sort('[]')).toBe('[]');
    expect(jsonc.sort('{ /* only */ "x": 1 }')).toBe('{ /* only */ "x": 1 }');
  });

  it('moves a comma written before a comment, and keeps a block comment before it', () => {
    expect(jsonc.sort('[3 /* c */, 1, 2]')).toBe('[1, 2, 3 /* c */]');
    // A gained comma goes right after the value, before the comment (README reading 1).
    expect(jsonc.sort('[3, 1 /* c */]')).toBe('[1, /* c */ 3]');
  });

  it('writes a // comment as a block comment where it no longer ends its line', () => {
    expect(jsonc.sort('{"b": 1, "a": 2 // c\n}')).toBe('{"a": 2, /* c */ "b": 1\n}');
  });

  it('sorts the container at a path, leaving others as they are', () => {
    expect(jsonc.sort('{"z": [2, 1], "a": {"d": 0, "c": 0}}', { path: '/a' })).toBe(
      '{"z": [2, 1], "a": {"c": 0, "d": 0}}',
    );
    expect(jsonc.sort('{"z": [2, 1]}', { path: '/z' })).toBe('{"z": [1, 2]}');
  });

  it('orders items by type like the library: booleans, numbers, strings, others, then missing', () => {
    expect(jsonc.sort('[{}, "b", 2, true, null, "A", 1, false]')).toBe(
      '[false, true, 1, 2, "A", "b", {}, null]',
    );
    expect(jsonc.sort('[{"k": 1}, {}, {"k": "x"}]', { property: '/k', direction: 'desc' })).toBe(
      '[{}, {"k": "x"}, {"k": 1}]',
    );
  });

  it('keeps equal members in their order, ascending and descending', () => {
    const text = '[{"k": 1, "i": 0}, {"k": 0}, {"k": 1, "i": 1}]';
    expect(jsonc.sort(text, { property: '/k' })).toBe(
      '[{"k": 0}, {"k": 1, "i": 0}, {"k": 1, "i": 1}]',
    );
    expect(jsonc.sort(text, { property: '/k', direction: 'desc' })).toBe(
      '[{"k": 1, "i": 0}, {"k": 1, "i": 1}, {"k": 0}]',
    );
  });

  it('puts members in a given order (003 T8), and refuses one that is not a permutation', () => {
    expect(jsonc.sort('{"a": 1, "b": 2, "c": 3}', { order: [2, 0, 1] })).toBe(
      '{"c": 3, "a": 1, "b": 2}',
    );
    expect(jsonc.sort('[1, 2]', { order: [0, 1] })).toBe('[1, 2]');
    for (const order of [[0], [0, 0], [0, 2], [1, 0.5]])
      expect(() => jsonc.sort('[1, 2]', { order })).toThrow(PatchError);
  });

  it('refuses a comma-first layout it would break (002 T10 review F1)', () => {
    const text = '{ "b": 1\n, "a": 2\n}\n';
    expect(() => jsonc.sort(text)).toThrow(/would not parse/);
    expect(() => getAdapter('json5').sort('{ b: 1\n, a: 2\n}\n')).toThrow(PatchError);
  });

  it('throws a PatchError for a path that is missing or not a container, and for no value', () => {
    expect(() => jsonc.sort('{"a": 1}', { path: '/a' })).toThrow(PatchError);
    expect(() => jsonc.sort('{"a": 1}', { path: '/b' })).toThrow(PatchError);
    expect(() => jsonc.sort('[1]', { path: '/x' })).toThrow(PatchError);
    expect(() => jsonc.sort('// nothing\n')).toThrow(PatchError);
    expect(() => jsonc.sort('{"a": }')).toThrow(PatchError);
  });
});

describe('format (003 T8, prettyPrint)', () => {
  const jsonc = getAdapter('jsonc');

  it('lays out data like JSON.stringify with the indent unit, keeping tokens as written', () => {
    const data = { a: [1, { b: null }], c: {}, d: [] };
    expect(getAdapter('json').prettyPrint(JSON.stringify(data))).toBe(
      JSON.stringify(data, null, 2),
    );
    expect(jsonc.prettyPrint('{\n\t"a": [1.0, 2E1]\n}\n')).toBe(
      '{\n\t"a": [\n\t\t1.0,\n\t\t2E1\n\t]\n}\n',
    );
  });

  it('keeps a byte order mark and does not read it as indentation (003 T8 review F2)', () => {
    for (const format of ['jsonc', 'json5'] as const) {
      expect(getAdapter(format).prettyPrint('\uFEFF{"a":1}')).toBe('\uFEFF{\n  "a": 1\n}');
    }
  });

  it('keeps the line ending and the final newline', () => {
    expect(jsonc.prettyPrint('{"a":\r\n1}\r\n')).toBe('{\r\n  "a": 1\r\n}\r\n');
    expect(jsonc.prettyPrint('[1]')).toBe('[\n  1\n]');
  });

  it('keeps comments on their lines, before or after what they were next to', () => {
    expect(jsonc.prettyPrint('[1, // one\n2 /* two */, /* three */ 3]')).toBe(
      '[\n  1, // one\n  2 /* two */,\n  /* three */ 3\n]',
    );
    expect(jsonc.prettyPrint('{"a": // why\n1}')).toBe('{\n  "a": // why\n  1\n}');
    expect(jsonc.prettyPrint('/* head */ {"a": 1} // tail')).toBe(
      '/* head */ {\n  "a": 1\n} // tail',
    );
  });

  it('keeps one blank line next to a comment, and none elsewhere', () => {
    expect(jsonc.prettyPrint('{\n\n"a": 1,\n\n// c\n\n"b": 2}')).toBe(
      '{\n  "a": 1,\n\n  // c\n\n  "b": 2\n}',
    );
  });

  it('writes a comma after a // comment on the next line, so it still follows its member', () => {
    expect(jsonc.prettyPrint('[1 // one\n, 2]')).toBe('[\n  1 // one\n  ,\n  2\n]');
  });

  it('keeps comments in an empty container, and the document with comments only', () => {
    expect(jsonc.prettyPrint('{ // none\n}')).toBe('{ // none\n}');
    expect(jsonc.prettyPrint('// a\n/* b */\n')).toBe('// a\n/* b */\n');
    expect(jsonc.prettyPrint('')).toBe('');
  });

  it('is unchanged when run again', () => {
    const once = jsonc.prettyPrint('{"a": [1, /* x */ 2], // y\n"b": {"c": 3}}');
    expect(jsonc.prettyPrint(once)).toBe(once);
  });

  it('throws a PatchError for a text that does not parse', () => {
    for (const format of formats)
      expect(() => getAdapter(format).prettyPrint('{"a": }')).toThrow(PatchError);
  });
});

// --- Criterion 8 over random commented documents ------------------------------------------------

/** Every comment's text without its delimiters: `// c1` and `/* c1 *\/` are both `c1`. */
function commentTexts(text: string): string[] {
  return [...text.matchAll(/\/\/ (c\d+)|\/\* (c\d+) \*\//g)].map((m) => m[1] ?? m[2]!).sort();
}

/** JSON Pointers of every object and array in `data`. */
function containers(data: unknown, path = ''): string[] {
  if (data === null || typeof data !== 'object') return [];
  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as const)
    : Object.entries(data);
  return [
    path,
    ...entries.flatMap(([k, v]) =>
      containers(v, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`),
    ),
  ];
}

/** The value at a JSON Pointer, by own members only. */
function getIn(data: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>(
      (v, k) =>
        v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, k)
          ? (v as Record<string, unknown>)[k]
          : undefined,
      data,
    );
}

/** For an array, pointers to the members of its items (`/key` of an object item, `/0` of an
 *  array item) to sort by; none for an object. */
function itemProperties(container: unknown): string[] {
  if (!Array.isArray(container)) return [];
  const keys = new Set<string>();
  for (const item of container as unknown[]) {
    if (Array.isArray(item)) {
      if (item.length > 0) keys.add('/0');
    } else if (item !== null && typeof item === 'object') {
      for (const k of Object.keys(item)) keys.add(`/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
  }
  return [...keys];
}

/** Data as text with its key order; equal numbers print the same (-0 as 0, NaN as null). */
const ordered = (data: unknown) => JSON.stringify(data);

function check(format: Format, action: 'compact' | 'sort' | 'format') {
  const adapter = getAdapter(format);
  fc.assert(
    fc.property(dataArbitrary(format), styleArbitrary, fc.gen(), (data, style, g) => {
      const input = printDocument(data, format, style, g);
      const parsed = adapter.parse(input);
      let output: string;
      let expected: unknown;
      if (action === 'compact') {
        output = adapter.compact(input);
        expected = parsed.data;
      } else if (action === 'format') {
        output = adapter.prettyPrint(input);
        expected = parsed.data;
        expect(adapter.prettyPrint(output)).toBe(output);
      } else {
        const paths = containers(parsed.data);
        if (paths.length === 0) return;
        const path = paths[g(fc.integer, { min: 0, max: paths.length - 1 })]!;
        const options: SortOptions = { path, direction: g(fc.boolean) ? 'asc' : 'desc' };
        // An array is sorted by a member of its items half the time, when an item has one.
        const properties = itemProperties(getIn(parsed.data, path));
        if (properties.length > 0 && g(fc.boolean))
          options.property = properties[g(fc.integer, { min: 0, max: properties.length - 1 })];
        output = adapter.sort(input, options);
        expected = sortData(parsed.data, { path, ...options });
      }
      const result = adapter.parse(output);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(ordered(result.data)).toBe(ordered(expected));
      expect(commentTexts(output)).toEqual(commentTexts(input));
      // The printed strings and comments hold no line break, so only the final newline is left.
      if (action === 'compact') expect(output.replace(/\r?\n$/, '')).not.toMatch(/[\r\n]/);
    }),
    { seed: SEED, numRuns: RUNS },
  );
}

describe('criterion 8: random commented documents keep their comments', () => {
  for (const format of formats) {
    for (const action of ['compact', 'sort', 'format'] as const) {
      it(`${format} ${action}: ${RUNS} runs, seed ${SEED}`, () => check(format, action), 60_000);
    }
  }
});
