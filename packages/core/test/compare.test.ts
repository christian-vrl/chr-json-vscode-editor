// 007 T1: examples of `compare` and `copyDifference` (spec 007 criteria 1 and 2); the property
// suite is compare.property.test.ts.
import { describe, expect, it } from 'vitest';
import { compare, copyDifference } from '../src/index.js';

describe('compare', () => {
  it('reports nothing for equal data, whatever the key order', () => {
    expect(compare({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toEqual([]);
    expect(compare(NaN, NaN)).toEqual([]);
    expect(compare(0, -0)).toEqual([{ kind: 'changed', leftPath: '', rightPath: '' }]);
  });

  it('gives object members a path on the side where they exist', () => {
    expect(compare({ a: 1, b: 2, c: 3 }, { b: 5, c: 3, d: 4 })).toEqual([
      { kind: 'removed', leftPath: '/a' },
      { kind: 'changed', leftPath: '/b', rightPath: '/b' },
      { kind: 'added', rightPath: '/d' },
    ]);
  });

  it('lists the members an object gains by key', () => {
    expect(compare({}, { z: 1, a: 2, m: 3 })).toEqual([
      { kind: 'added', rightPath: '/a' },
      { kind: 'added', rightPath: '/m' },
      { kind: 'added', rightPath: '/z' },
    ]);
  });

  it('escapes keys as JSON Pointer tokens', () => {
    expect(compare({ 'a/b': { '~': 1 } }, { 'a/b': { '~': 2 } })).toEqual([
      { kind: 'changed', leftPath: '/a~1b/~0', rightPath: '/a~1b/~0' },
    ]);
  });

  it('gives array items their index on each side', () => {
    // diff: add /0, then 'c' and [2] are paired at /4 (left 4 - 1 added = 3), remove /5 (left 4).
    expect(compare(['x', 'a', 'b', 'c', [1]], ['new', 'x', 'a', 'b', [2]])).toEqual([
      { kind: 'added', rightPath: '/0' },
      { kind: 'changed', leftPath: '/3', rightPath: '/4' },
      { kind: 'removed', leftPath: '/4' },
    ]);
    expect(compare(['x', [1]], ['new', 'x', [2]])).toEqual([
      { kind: 'added', rightPath: '/0' },
      { kind: 'changed', leftPath: '/1/0', rightPath: '/2/0' },
    ]);
    expect(compare([1, 2, 3, 4], [1, 4])).toEqual([
      { kind: 'removed', leftPath: '/1' },
      { kind: 'removed', leftPath: '/2' },
    ]);
    // [0] is kept (left 0, right 2); 9 pairs with [1] and the second [0] is removed.
    expect(compare([[0], 9, [0]], [7, 8, [0], [1]])).toEqual([
      { kind: 'added', rightPath: '/0' },
      { kind: 'added', rightPath: '/1' },
      { kind: 'changed', leftPath: '/1', rightPath: '/3' },
      { kind: 'removed', leftPath: '/2' },
    ]);
  });

  it('maps nested arrays inside shifted items', () => {
    expect(compare([1, { x: [1, 2] }], [0, 0, 1, { x: [2] }])).toEqual([
      { kind: 'added', rightPath: '/0' },
      { kind: 'added', rightPath: '/1' },
      { kind: 'removed', leftPath: '/1/x/0' },
    ]);
  });
});

describe('copyDifference', () => {
  it('replaces, removes and adds object members', () => {
    const left = { a: 1, b: 2 };
    const right = { b: 3, c: 4 };
    const [removed, changed, added] = compare(left, right);
    expect(copyDifference(right, left, removed!)).toEqual([{ op: 'remove', path: '/a' }]);
    expect(copyDifference(right, left, changed!)).toEqual([
      { op: 'replace', path: '/b', value: 3 },
    ]);
    expect(copyDifference(right, left, added!)).toEqual([{ op: 'add', path: '/c', value: 4 }]);
    expect(copyDifference(left, right, removed!, 'left')).toEqual([
      { op: 'add', path: '/a', value: 1 },
    ]);
    expect(copyDifference(left, right, changed!, 'left')).toEqual([
      { op: 'replace', path: '/b', value: 2 },
    ]);
    expect(copyDifference(left, right, added!, 'left')).toEqual([{ op: 'remove', path: '/c' }]);
  });

  it('adds an array item after the item aligned with its previous neighbour', () => {
    const left = { list: [{ id: 1 }, 'gone', 'kept'] };
    const right = { list: ['new', { id: 1 }, 'kept', 'also new'] };
    const differences = compare(left, right);
    expect(differences).toEqual([
      { kind: 'added', rightPath: '/list/0' },
      { kind: 'removed', leftPath: '/list/1' },
      { kind: 'added', rightPath: '/list/3' },
    ]);
    expect(copyDifference(right, left, differences[0]!)).toEqual([
      { op: 'add', path: '/list/0', value: 'new' },
    ]);
    // After 'kept' (left 2, right 2).
    expect(copyDifference(right, left, differences[2]!)).toEqual([
      { op: 'add', path: '/list/3', value: 'also new' },
    ]);
    // From the left: 'gone' goes after the right's { id: 1 } (right 1), before its 'kept'.
    expect(copyDifference(left, right, differences[1]!, 'left')).toEqual([
      { op: 'add', path: '/list/2', value: 'gone' },
    ]);
  });

  it('follows the alignment into shifted items', () => {
    const left = [1, { x: [1, 2] }];
    const right = [0, 0, 1, { x: [2] }];
    const removed = compare(left, right)[2]!;
    expect(copyDifference(left, right, removed, 'left')).toEqual([
      { op: 'add', path: '/3/x/0', value: 1 },
    ]);
  });

  it('copies the root', () => {
    expect(copyDifference([2], { a: 1 }, compare({ a: 1 }, [2])[0]!)).toEqual([
      { op: 'replace', path: '', value: [2] },
    ]);
  });

  it('can drop more than one difference (UNK-039)', () => {
    // The copy makes the left item equal to the right's second item, which then aligns with it.
    const left = [{ a: 1, b: 1 }];
    const right = [
      { a: 2, b: 2 },
      { a: 2, b: 1 },
    ];
    expect(compare(left, right)).toHaveLength(3);
    const patch = copyDifference(right, left, compare(left, right)[0]!);
    expect(patch).toEqual([{ op: 'replace', path: '/0/a', value: 2 }]);
    expect(compare([{ a: 2, b: 1 }], right)).toEqual([{ kind: 'added', rightPath: '/0' }]);
  });
});
