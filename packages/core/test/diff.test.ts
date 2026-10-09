// 002 T9: examples for `diff(a, b)`; the criterion 9 properties are in diff.property.test.ts.
import { describe, expect, it } from 'vitest';
import { diff, getAdapter, type PatchOperation } from '../src/index.js';

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

  it('pairs items by position when the arrays differ too much to search (002 T9 review)', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => ({ id: i }));
    const b = [
      { id: 'first' },
      ...a.slice(0, 5).map((x) => ({ id: -x.id - 1 })),
      ...Array.from({ length: 30_000 }, (_, i) => ({ id: `n${i}` })),
    ];
    const started = performance.now();
    const patch = diff(a, b);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(patch).toHaveLength(b.length);
    expect(patch.slice(0, 2)).toEqual([
      { op: 'replace', path: '/0/id', value: 'first' },
      { op: 'replace', path: '/1/id', value: -1 },
    ]);
    expect(applyInPlace(structuredClone(a), patch)).toEqual(b);
  });

  it('keeps the common start and end when it pairs by position', () => {
    const middle = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
    const a = ['start', ...middle(12_000, 'a'), 'end'];
    const b = ['start', ...middle(12_000, 'b'), 'end'];
    const patch = diff(a, b);
    expect(patch).toHaveLength(12_000);
    expect(patch.every((op) => op.op === 'replace' && op.path !== '/0')).toBe(true);
    expect(applyInPlace(structuredClone(a), patch)).toEqual(b);
  });

  it('handles one container with more steps than a call can take as arguments (review F1)', () => {
    const n = 200_000;
    const a = Array.from({ length: n }, (_, i) => i);
    const b = Array.from({ length: n }, (_, i) => -1 - i);
    const arrayOps = diff(a, b);
    expect(arrayOps).toHaveLength(n);
    expect(arrayOps[0]).toEqual({ op: 'replace', path: '/0', value: -1 });
    expect(arrayOps.at(-1)).toEqual({ op: 'replace', path: `/${n - 1}`, value: -n });

    const before = Object.fromEntries(a.map((i) => [`k${i}`, i]));
    const after = Object.fromEntries(a.map((i) => [`k${i}`, i + 1]));
    const objectOps = diff(before, after);
    expect(objectOps).toHaveLength(n);
    expect(objectOps[0]).toEqual({ op: 'replace', path: '/k0', value: 1 });
  });

  it('still finds only inserts or only removes past the search budget (criterion 9)', () => {
    const a = Array.from({ length: 20_000 }, (_, i) => i);
    const b = a.flatMap((x) => (x % 2 === 0 ? [x, -x - 1] : [x]));
    const started = performance.now();
    const inserts = diff(a, b);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(inserts).toHaveLength(10_000);
    expect(inserts.every((op) => op.op === 'add')).toBe(true);
    const removes = diff(b, a);
    expect(removes).toHaveLength(10_000);
    expect(removes.every((op) => op.op === 'remove')).toBe(true);
    expect(applyInPlace([...a], inserts)).toEqual(b);
    expect(applyInPlace([...b], removes)).toEqual(a);
  });

  it('handles data nested deeper than the call stack (002 T9 review)', () => {
    let a: unknown = 1;
    let b: unknown = 2;
    for (let i = 0; i < 10_000; i++) {
      a = { x: [a] };
      b = { x: [b] };
    }
    const patch = diff(a, b);
    expect(patch).toHaveLength(1);
    expect(patch[0]!.op).toBe('replace');
    expect(patch[0]!.path).toBe('/x/0'.repeat(10_000));
    expect(diff(a, a)).toEqual([]);
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

/** Applies add, remove and replace in place: immutable-json-patch copies the array on every
 *  operation, too slow for tens of thousands of them. */
function applyInPlace(data: unknown[], patch: PatchOperation[]): unknown[] {
  type Node = Record<string, unknown> & unknown[];
  for (const op of patch) {
    const tokens = op.path.split('/').slice(1);
    const last = tokens.pop()!;
    const parent = tokens.reduce((v: Node, k) => v[k as keyof Node] as Node, data as Node);
    if (op.op === 'remove') parent.splice(Number(last), 1);
    else if (op.op === 'add') parent.splice(Number(last), 0, op.value);
    else if (op.op === 'replace') parent[last] = op.value;
  }
  return data;
}
