// 002 T9: examples for `diff(a, b)`; the criterion 9 properties are in diff.property.test.ts.
import { describe, expect, it } from 'vitest';
import { diff, getAdapter } from '../src/index.js';

describe('diff', () => {
  it('is empty for deep-equal values, whatever the key order', () => {
    expect(diff({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toEqual([]);
    expect(diff(NaN, NaN)).toEqual([]);
  });

  it('replaces scalars, kinds that differ and the root', () => {
    expect(diff(1, 2)).toEqual([{ op: 'replace', path: '', value: 2 }]);
    expect(diff(0, -0)).toEqual([{ op: 'replace', path: '', value: -0 }]);
    expect(diff({ a: [1] }, { a: { 0: 1 } })).toEqual([
      { op: 'replace', path: '/a', value: { 0: 1 } },
    ]);
  });

  it('removes, changes in place and appends object members', () => {
    expect(diff({ a: 1, b: { c: 1, d: 2 }, e: 3 }, { b: { c: 1, d: 5 }, e: 3, f: 4 })).toEqual([
      { op: 'remove', path: '/a' },
      { op: 'replace', path: '/b/d', value: 5 },
      { op: 'add', path: '/f', value: 4 },
    ]);
  });

  it('escapes keys as RFC 6901 tokens', () => {
    expect(diff({ 'a/b': 1, 'm~n': 1 }, { 'a/b': 2, 'm~n': 2, '': 0 })).toEqual([
      { op: 'replace', path: '/a~1b', value: 2 },
      { op: 'replace', path: '/m~0n', value: 2 },
      { op: 'add', path: '/', value: 0 },
    ]);
  });

  it('treats __proto__ as a member', () => {
    const b = JSON.parse('{"__proto__": 1}') as unknown;
    expect(diff({}, b)).toEqual([{ op: 'add', path: '/__proto__', value: 1 }]);
    expect(diff(b, {})).toEqual([{ op: 'remove', path: '/__proto__' }]);
  });

  it('keeps the longest common run of array items and inserts or removes the rest', () => {
    expect(diff([1, 2, 3, 4], [0, 1, 3, 4, 5])).toEqual([
      { op: 'add', path: '/0', value: 0 },
      { op: 'remove', path: '/2' },
      { op: 'add', path: '/4', value: 5 },
    ]);
    expect(diff([{ id: 1 }, { id: 2 }], [{ id: 2 }])).toEqual([{ op: 'remove', path: '/0' }]);
  });

  it('diffs an item changed in place, so its other members stay', () => {
    expect(diff([1, { id: 2, n: 'x' }, 3], [1, { id: 2, n: 'y' }, 3])).toEqual([
      { op: 'replace', path: '/1/n', value: 'y' },
    ]);
  });

  it('keeps comments on members that survive, in text (R14)', () => {
    const text = '{\n  // keep\n  "a": [1, 2, 3], // a\n  /* gone */\n  "b": true\n}\n';
    const adapter = getAdapter('jsonc');
    const patch = diff(adapter.parse(text).data, { a: [1, 3, 4], c: null });
    expect(adapter.applyPatch(text, patch)).toBe(
      '{\n  // keep\n  "a": [1, 3, 4], // a\n  "c": null\n}\n',
    );
  });

  it('handles long arrays with few changes quickly', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => ({ i }));
    const b = [...a.slice(0, 20_000), { i: -1 }, ...a.slice(20_001, 49_000)];
    const started = performance.now();
    const patch = diff(a, b);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(patch).toEqual([
      { op: 'replace', path: '/20000/i', value: -1 },
      ...Array.from({ length: 1_000 }, () => ({ op: 'remove', path: '/49000' })),
    ]);
  });
});
