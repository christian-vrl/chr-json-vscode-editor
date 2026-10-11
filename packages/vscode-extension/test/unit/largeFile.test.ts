// Large-file mode in the host (spec 008 T3): the threshold measured in UTF-8, and the host's reads
// of a locked tab's text through core's data-only parse (criterion 8).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedParseTexts, detect, getAdapter, releaseParse } from '@chr-json-editor/core';
import { reparse, type FormatCore } from '../../src/formatBadge';
import {
  dataOf,
  dataOrError,
  LARGE_FILE_THRESHOLD,
  largeFileFor,
  utf8Length,
} from '../../src/largeFile';
import { topLevelSchema } from '../../src/schemaBinding';
import { compileSchema, validateText } from '../../src/validation';

afterEach(() => {
  vi.useRealTimers();
  releaseParse();
});

describe('utf8Length', () => {
  it.each([
    '',
    'ascii {"a": 1}',
    'é ü ñ',
    '€ ✓ 中文',
    '😀 😀',
    'lone \ud800 high, lone \udc00 low, \ud800 at the end \ud800',
  ])('counts what TextEncoder writes: %j', (text) => {
    expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
  });
});

describe('largeFileFor (criterion 1: above 5 MiB of UTF-8)', () => {
  const ascii = (bytes: number) => `"${'a'.repeat(bytes - 2)}"`;

  it('opens exactly 5,242,880 bytes in the normal editor and one more in large-file mode', () => {
    expect(LARGE_FILE_THRESHOLD).toBe(5_242_880);
    expect(largeFileFor(ascii(5_242_880))).toBeNull();
    expect(largeFileFor(ascii(5_242_881))).toEqual({ bytes: 5_242_881, unlocked: false });
  });

  it('counts bytes, not UTF-16 code units', () => {
    // 2,621,441 two-byte characters: half as many code units as bytes.
    const text = 'é'.repeat(2_621_441);
    expect(text.length).toBeLessThan(LARGE_FILE_THRESHOLD);
    expect(largeFileFor(text)).toEqual({ bytes: 5_242_882, unlocked: false });
  });

  it('leaves small texts alone', () => {
    expect(largeFileFor('{"a": 1}')).toBeNull();
  });
});

describe('dataOf', () => {
  it('reads the same text once while it is kept, and keeps nothing in core', () => {
    vi.useFakeTimers();
    releaseParse();
    const text = '{\n  // comment\n  "a": [1, 2,],\n}';
    const first = dataOf('jsonc', text);
    expect(first).toEqual({ data: { a: [1, 2] } });
    expect(dataOf('jsonc', `${text}`)).toBe(first);
    expect(dataOf('json5', text)).not.toBe(first);
    expect(cachedParseTexts()).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(dataOf('json5', text)).toEqual({ data: { a: [1, 2] } });
  });

  it('says why a text has no data', () => {
    expect(dataOrError('json', '{"a": }')).toEqual({ error: 'ValueExpected' });
    expect(dataOrError('json5', '')).toHaveProperty('error');
  });
});

describe('data-only reads (criterion 8)', () => {
  const core: FormatCore = { detect, getAdapter, parseData: dataOf };
  const text = '{"$schema": "./s.json", "a": [1, 2]}';

  it('the badge: valid or one error, and no parse left in core', () => {
    releaseParse();
    expect(reparse(core, text, 'json', true)).toEqual({ kind: 'parsed', errors: 0, warnings: 0 });
    expect(reparse(core, '{"a": ', 'json5', true)).toEqual({
      kind: 'parsed',
      errors: 1,
      warnings: 0,
    });
    expect(cachedParseTexts()).toEqual([]);
  });

  it('validation and $schema read the data the full parse reads', () => {
    releaseParse();
    const compiled = compileSchema({ properties: { a: { type: 'array', maxItems: 1 } } });
    if (!compiled.ok) throw new Error(compiled.reason);
    const dataOnly = validateText(text, 'json', compiled.validate, true);
    expect(dataOnly).toMatchObject({ kind: 'errors', errors: [{ keyword: 'maxItems' }] });
    expect(validateText('{"a": ', 'json', compiled.validate, true)).toEqual({
      kind: 'skipped',
      reason: 'The document does not parse, so it was not validated.',
    });
    expect(topLevelSchema(text, 'jsonc', true)).toBe('./s.json');
    expect(topLevelSchema('[1]', 'jsonc', true)).toBeUndefined();
    expect(cachedParseTexts()).toEqual([]);
    expect(validateText(text, 'json', compiled.validate)).toEqual(dataOnly);
    expect(topLevelSchema(text, 'jsonc')).toBe('./s.json');
  });
});
