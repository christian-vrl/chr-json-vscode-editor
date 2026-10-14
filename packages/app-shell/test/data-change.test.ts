// What the UI sends for new data over an object or array (003 T8): a pure reordering as core's
// sort with that order (002 R13), anything else as core's diff under the container's path (R14).
import { describe, expect, it } from 'vitest';
import { LosslessNumber } from '@chr-json-editor/core';
import { dataChange, reordering } from '../src/data-change.js';

describe('dataChange', () => {
  it('sends a reordering of object members as a sort with the old index of each', () => {
    expect(dataChange('/obj', { b: 1, c: 2, a: 3 }, { a: 3, b: 1, c: 2 })).toEqual({
      kind: 'action',
      action: { name: 'sort', path: '/obj', order: [2, 0, 1] },
    });
  });

  it('sends a reordering of array items as a sort, equal items keeping their order', () => {
    expect(dataChange('', [3, 1, { x: 1 }, 1], [1, 1, 3, { x: 1 }])).toEqual({
      kind: 'action',
      action: { name: 'sort', path: '', order: [1, 3, 0, 2] },
    });
  });

  it('sends nothing when the data and its order are unchanged', () => {
    expect(dataChange('', { a: 1, b: [2] }, { a: 1, b: [2] })).toBeUndefined();
    expect(dataChange('', [1, 2], [1, 2])).toBeUndefined();
  });

  it('sends any other change as a diff under the path', () => {
    expect(
      dataChange('/list', [{ n: 'a' }, { n: 'b' }, { n: 'c' }], [{ n: 'a' }, { n: 'c' }]),
    ).toEqual({ kind: 'patch', patch: [{ op: 'remove', path: '/list/1' }] });
    expect(dataChange('', { a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      kind: 'patch',
      patch: [{ op: 'replace', path: '/b', value: 3 }],
    });
  });

  it('does not take a change inside a member, or a key order inside one, for a reordering', () => {
    expect(reordering([{ a: 1, b: 2 }, 1], [1, { b: 2, a: 1 }])).toBeUndefined();
    expect(reordering({ a: 1, b: 2 }, { b: 2, a: 9 })).toBeUndefined();
    expect(reordering({ a: 1 }, { a: 1, b: 2 })).toBeUndefined();
    expect(reordering([1, 2], [2, 2])).toBeUndefined();
  });

  it('tells JSON5 numbers JSON cannot write apart from null and 0', () => {
    expect(reordering([NaN, null], [null, NaN])).toEqual([1, 0]);
    expect(reordering([-0, 0], [0, -0])).toEqual([1, 0]);
    expect(reordering([Infinity, null], [null, null])).toBeUndefined();
  });

  // Spec 015 B3: big numbers key by exact value, as core's diff does.
  it('keys big numbers by exact value, apart from an object that looks like one', () => {
    const big = (v: string) => new LosslessNumber(v);
    const a = big('12345678901234567890');
    const b = big('12345678901234567891');
    expect(reordering([a, b], [b, a])).toEqual([1, 0]);
    expect(reordering([a, 5], [5, big('12345678901234567890')])).toEqual([1, 0]);
    expect(reordering([a], [b])).toBeUndefined();
    // Equal exact values: 1e20 is exactly 100000000000000000000, and 1e400 is not Infinity.
    expect(reordering([big('100000000000000000000'), 1], [1, 1e20])).toEqual([1, 0]);
    expect(reordering([big('1e400')], [Infinity])).toBeUndefined();
    const lookAlike = { isLosslessNumber: true, value: '12345678901234567890' };
    expect(reordering([a, lookAlike], [lookAlike, a])).toEqual([1, 0]);
    expect(reordering([a], [lookAlike])).toBeUndefined();
    expect(dataChange('/ids', [a, b], [b, a])).toEqual({
      kind: 'action',
      action: { name: 'sort', path: '/ids', order: [1, 0] },
    });
  });

  it('reads an array and an object as different containers', () => {
    expect(reordering([1], { 0: 1 })).toBeUndefined();
  });
});
