// Each adapter parses a text once, however many callers parse or edit it (cache.ts, UNK-014).
import { describe, expect, it, vi } from 'vitest';
import { lastText } from '../src/formats/cache.js';
import { getAdapter, releaseParse, type Format } from '../src/index.js';

describe('lastText', () => {
  it('computes once for equal texts and again for a different one', () => {
    const compute = vi.fn((text: string) => ({ length: text.length }));
    const cached = lastText(compute);
    const first = cached('{"a": 1}');
    expect(cached(['{"a"', ' 1}'].join(':'))).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cached('[]')).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing when the computation throws', () => {
    const cached = lastText((text: string) => {
      if (text === 'bad') throw new Error('bad');
      return { text };
    });
    const good = cached('good');
    expect(() => cached('bad')).toThrow('bad');
    expect(cached('good')).toBe(good);
  });
});

describe('adapters', () => {
  for (const format of ['json', 'jsonc', 'json5'] as Format[]) {
    it(`${format}: parse returns the same result for the same text, and edits still apply`, () => {
      const adapter = getAdapter(format);
      const text = '{\n  "a": 1,\n  "b": [1, 2]\n}\n';
      const parsed = adapter.parse(text);
      expect(adapter.parse(`${text}`)).toBe(parsed);
      const edited = adapter.applyPatch(text, [{ op: 'replace', path: '/a', value: 2 }]);
      expect(edited).toBe('{\n  "a": 2,\n  "b": [1, 2]\n}\n');
      expect(adapter.parse(edited).data).toEqual({ a: 2, b: [1, 2] });
      expect(adapter.parse(text)).not.toBe(parsed);
      expect(adapter.parse(text).data).toEqual({ a: 1, b: [1, 2] });
    });
  }

  it('releaseParse drops the parse of that text in every format, and only of that text', () => {
    const text = '{"released": [1, 2, 3]}';
    const other = '{"kept": true}';
    const json5 = getAdapter('json5');
    const jsonc = getAdapter('jsonc');
    const kept = json5.parse(other);
    const parsed = jsonc.parse(text);
    releaseParse(other.replace('kept', 'never parsed'));
    expect(json5.parse(other)).toBe(kept);
    releaseParse(text);
    expect(json5.parse(other)).toBe(kept);
    const again = jsonc.parse(text);
    expect(again).not.toBe(parsed);
    expect(again.data).toEqual(parsed.data);
    releaseParse();
    expect(json5.parse(other)).not.toBe(kept);
  });
});
