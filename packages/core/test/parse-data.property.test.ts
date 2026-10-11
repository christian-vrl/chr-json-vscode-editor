// 008 T1 gate, spec 008 criterion 6: for 10 000 random documents per format (seed committed in
// `arbitraries.ts`) and a single-character mutation of each, `parseData(format, text)` gives the
// data `getAdapter(format).parse(text)` gives, or its first error's message and offset; the golden
// inputs are checked in `tests/golden/parse-data.test.ts`. `parseData` never adds an entry to core's
// parse cache.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAdapter, parseData, releaseParse, stringify, type Format } from '../src/index.js';
import { dataArbitrary, SEED, styleArbitrary } from './arbitraries.js';
import { expectAgrees } from './parse-data-agrees.js';
import { printDocument } from './print-document.js';

const RUNS = 10_000;
const formats = ['json', 'jsonc', 'json5'] as const;

/** Characters a mutation inserts or writes over another: every token's first character, escapes,
 *  comment starts, JSON5 number and identifier characters, and white space or line terminators
 *  only some formats accept. */
const MUTATIONS = [
  ...'{}[],:"\'/*\\-+.0123456789eExXabfnrtuINn_$ \t\n\r',
  '\v',
  '\f',
  ' ',
  '﻿',
  ' ',
  ' ',
  '\u0000',
  '\u001f',
  'é',
  '\ud83d',
];

type Gen = fc.GeneratorValue;

/** `text` with one character deleted, inserted or replaced at a random place. */
function mutate(text: string, g: Gen): string {
  const at = g(fc.integer, { min: 0, max: text.length });
  const char = MUTATIONS[g(fc.integer, { min: 0, max: MUTATIONS.length - 1 })]!;
  switch (g(fc.constantFrom, 'delete', 'insert', 'replace')) {
    case 'delete':
      return text.slice(0, at) + text.slice(at + 1);
    case 'insert':
      return text.slice(0, at) + char + text.slice(at);
    default:
      return text.slice(0, at) + char + text.slice(at + 1);
  }
}

describe('criterion 6: parseData agrees with parse', () => {
  for (const format of formats) {
    it(`${format}: ${RUNS} documents and mutations, seed ${SEED}`, () => {
      fc.assert(
        fc.property(dataArbitrary(format), styleArbitrary, fc.gen(), (data, style, g) => {
          // Commented documents for JSONC and JSON5 (the format's own walk), and plain `stringify`
          // output, which is strict JSON for `json` (the `JSON.parse` path).
          const text = g(fc.boolean)
            ? printDocument(data, format, style, g)
            : stringify(data, format, style);
          expectAgrees(format, text);
          expectAgrees(format, mutate(text, g));
        }),
        { seed: SEED, numRuns: RUNS },
      );
    }, 300_000);
  }

  // The edges plan 008 risk R1 names, and texts with no value.
  const edges = [
    '',
    ' ',
    '﻿{}',
    '// only a comment',
    '{"__proto__": {"a": 1}, "b": 2}',
    '{"a": 1, "b": 2, "a": 3}',
    '-0',
    '[-0, 0, -0.0, 1e400, -1e-400]',
    '"\\ud800"',
    '"\ud800"',
    '{a: 0x1F, b: +.5, c: -Infinity, d: NaN}',
    "'line \\\ncontinued'",
    '"a b"',
    '[1, 2,]',
    '{"a": 1,}',
    '[,]',
    '{"a" 1}',
    '[1 2]',
    '{"a": /* c */ 1} // end',
    '[1] [2]',
    '9'.repeat(400),
  ];
  for (const format of formats) {
    it(`${format}: edge texts`, () => {
      for (const text of edges) expectAgrees(format, text);
    });
  }
});

describe('criterion 6: the vendored json5-tests corpus', () => {
  const corpus = fileURLToPath(new URL('fixtures/json5-tests/', import.meta.url));
  const files = fs
    .readdirSync(corpus, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(json|json5|js|txt)$/.test(f));
  it(`agrees on all ${files.length} files in every format`, () => {
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const text = fs.readFileSync(path.join(corpus, file), 'utf8');
      for (const format of formats) expectAgrees(format, text);
    }
  });
});

describe('criterion 6: parseData never adds an entry to the parse cache', () => {
  const text = (format: Format) => (format === 'json5' ? '{a: [1, 2]} // x' : '{"a": [1, 2]} // x');
  for (const format of formats) {
    it(`${format}: the last parse stays cached`, () => {
      releaseParse();
      const adapter = getAdapter(format);
      const parsed = adapter.parse(text(format));
      // Core keeps one parse per format, so a parse of other texts would replace this one.
      for (const other of ['{"b": 1}', '{"b": 1} /* c */', '{b: 1}', '[', ''])
        parseData(format, other);
      expect(adapter.parse(text(format))).toBe(parsed);
      // The cached text itself is read again, not taken from (or put in) the cache.
      const light = parseData(format, text(format));
      expect(light).toEqual({ data: { a: [1, 2] } });
      expect((light as { data: unknown }).data).not.toBe(parsed.data);
    });
  }
});
