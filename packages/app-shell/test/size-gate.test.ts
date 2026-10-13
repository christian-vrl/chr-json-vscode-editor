// Spec 011 criterion 11's size gate (011 T6): the threshold in UTF-8 bytes of the text, and which
// languages Transform keeps above it. The dialog itself is checked in the web and e2e tests.
import { describe, expect, it } from 'vitest';
import type { QueryLanguage } from 'vanilla-jsoneditor';
import {
  isAboveQuerySizeLimit,
  QUERY_SIZE_LIMIT_BYTES,
  queryLanguagesFor,
  SIZE_GATED_QUERY_LANGUAGES,
} from '../src/query/size-gate.js';

const LIMIT = QUERY_SIZE_LIMIT_BYTES;
const language = (id: string) => ({ id, name: id }) as unknown as QueryLanguage;
const ALL = ['jsonquery', 'jmespath', 'jsonpath', 'javascript', 'lodash'].map(language);

describe('isAboveQuerySizeLimit', () => {
  it('is spec 008 threshold, 5 MiB', () => {
    expect(LIMIT).toBe(5_242_880);
  });

  it('counts UTF-8 bytes, as TextEncoder writes them', () => {
    const encoder = new TextEncoder();
    for (const text of ['a', 'é', '€', '😀', '\ud800', '\udc00x', 'a\ud83d', 'añ€😀\ud800z']) {
      const bytes = encoder.encode(text).length;
      expect(isAboveQuerySizeLimit(text, bytes), text).toBe(false);
      expect(isAboveQuerySizeLimit(text, bytes - 1), text).toBe(true);
    }
  });

  it('is false at the threshold and true one byte above it', () => {
    expect(isAboveQuerySizeLimit('a'.repeat(LIMIT))).toBe(false);
    expect(isAboveQuerySizeLimit('a'.repeat(LIMIT + 1))).toBe(true);
    // Fewer code units than bytes: 2-byte characters decide it only when counted.
    const half = 'é'.repeat(LIMIT / 2);
    expect(isAboveQuerySizeLimit(half)).toBe(false);
    expect(isAboveQuerySizeLimit(half + 'a')).toBe(true);
  });
});

describe('queryLanguagesFor', () => {
  it('gates JavaScript and Lodash, the library ids', async () => {
    const library = await import('vanilla-jsoneditor');
    expect([...SIZE_GATED_QUERY_LANGUAGES].sort()).toEqual(
      [library.javascriptQueryLanguage.id, library.lodashQueryLanguage.id].sort(),
    );
  });

  it('lists every language at or below the threshold, the same list', () => {
    expect(queryLanguagesFor(ALL, 'a'.repeat(LIMIT))).toBe(ALL);
  });

  it('leaves the gated ones out above it, in order', () => {
    expect(queryLanguagesFor(ALL, 'a'.repeat(LIMIT + 1)).map((l) => l.id)).toEqual([
      'jsonquery',
      'jmespath',
      'jsonpath',
    ]);
  });

  it('returns a list without gated languages as it is', () => {
    const plain = ALL.slice(0, 3);
    expect(queryLanguagesFor(plain, 'a'.repeat(LIMIT + 1))).toBe(plain);
  });
});
