// Large-file mode in the host (spec 008 T3): the threshold measured in UTF-8, and the host's reads
// of a locked tab's text through core's data-only parse (criterion 8).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedParseTexts, detect, getAdapter, releaseParse } from '@chr-json-editor/core';
import { reparse, type FormatCore } from '../../src/formatBadge';
import {
  dataOf,
  dataOrError,
  aboveThreshold,
  LARGE_FILE_THRESHOLD,
  largeFileFor,
  releaseData,
  testValidationLimit,
  thresholdBytes,
  thresholdLabel,
  utf8Length,
  VALIDATION_LIMIT_BYTES,
  validationPaused,
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

describe('the threshold setting (spec 019 T1, UNK-087 ★)', () => {
  const ascii = (bytes: number) => `"${'a'.repeat(bytes - 2)}"`;

  it('is the setting in MiB × 1,048,576, 5 MiB by default', () => {
    expect(thresholdBytes({ largeFileThreshold: 5 })).toBe(LARGE_FILE_THRESHOLD);
    expect(thresholdBytes({ largeFileThreshold: 6 })).toBe(6_291_456);
    expect(thresholdBytes({ largeFileThreshold: 1 })).toBe(1_048_576);
    expect(thresholdBytes({ largeFileThreshold: 50 })).toBe(52_428_800);
    expect(thresholdLabel(LARGE_FILE_THRESHOLD)).toBe('5 MiB');
    expect(thresholdLabel(6_291_456)).toBe('6 MiB');
  });

  it('at 6 opens 6,291,456 bytes in the normal editor and one more in large-file mode', () => {
    const six = thresholdBytes({ largeFileThreshold: 6 });
    expect(largeFileFor(ascii(6_291_456), six)).toBeNull();
    expect(largeFileFor(ascii(6_291_457), six)).toEqual({ bytes: 6_291_457, unlocked: false });
    expect(aboveThreshold(ascii(6_291_456), six)).toBe(false);
    expect(aboveThreshold(ascii(6_291_457), six)).toBe(true);
  });

  it('at 1 opens 2 MiB in large-file mode, counted in UTF-8', () => {
    const one = thresholdBytes({ largeFileThreshold: 1 });
    expect(largeFileFor(ascii(2 * 1_048_576), one)).toEqual({
      bytes: 2_097_152,
      unlocked: false,
    });
    // 524,289 two-byte characters: 1 MiB + 2 bytes in half as many code units.
    expect(aboveThreshold('é'.repeat(524_289), one)).toBe(true);
    expect(aboveThreshold('é'.repeat(524_288), one)).toBe(false);
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

  it('drops the kept result on releaseData', () => {
    const text = '[1, 2]';
    const first = dataOf('json', text);
    expect(dataOf('json', text)).toBe(first);
    releaseData();
    expect(dataOf('json', text)).not.toBe(first);
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

describe("validationPaused (criterion 10: above UNK-041's size)", () => {
  afterEach(() => {
    testValidationLimit.bytes = undefined;
  });

  it('pauses large-file tabs above the limit, locked or not, and never the normal editor', () => {
    const at = VALIDATION_LIMIT_BYTES;
    expect(VALIDATION_LIMIT_BYTES).toBeGreaterThanOrEqual(LARGE_FILE_THRESHOLD);
    expect(validationPaused(null)).toBe(false);
    expect(validationPaused({ bytes: at, unlocked: false })).toBe(false);
    expect(validationPaused({ bytes: at + 1, unlocked: false })).toBe(true);
    expect(validationPaused({ bytes: at + 1, unlocked: true })).toBe(true);
    testValidationLimit.bytes = at + 1;
    expect(validationPaused({ bytes: at + 1, unlocked: false })).toBe(false);
  });
});
