// B3's order for the library's sort dialog and table header sort (spec 015 B3, 015 T4): the
// library's own order (its sort.ts comparator, reproduced here with natural-compare-lite as the
// golden sort reference does) with numbers, plain and big, put in exact-value order.
import { compareNumbers, LosslessNumber } from '@chr-json-editor/core';
import fc from 'fast-check';
import { getIn, type JSONPath } from 'immutable-json-patch';
import naturalCompare from 'natural-compare-lite';
import { parseJSONPath } from 'vanilla-jsoneditor';
import { describe, expect, it } from 'vitest';
import { reordering } from '../src/data-change.js';
import { EditorNumber } from '../src/editor-numbers.js';
import { parserFor } from '../src/parser.js';
import { columnPath, exactOrder, onlyNestedPath } from '../src/sort-order.js';

/** vanilla-jsoneditor 3.13.0's array sort (src/lib/logic/sort.ts `createObjectComparator`). */
function librarySort(items: unknown[], itemPath: JSONPath, direction: 1 | -1): unknown[] {
  const kinds: Record<string, number> = { boolean: 0, number: 1, string: 2, undefined: 4 };
  const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);
  return items.slice().sort((a, b) => {
    const va = getIn(a, itemPath) as unknown;
    const vb = getIn(b, itemPath) as unknown;
    if (typeof va !== typeof vb) {
      const ka = kinds[typeof va] ?? 3;
      const kb = kinds[typeof vb] ?? 3;
      return ka > kb ? direction : ka < kb ? -direction : 0;
    }
    if (typeof va === 'number' || typeof va === 'boolean')
      return (va as number) > (vb as number) ? direction : va < (vb as number) ? -direction : 0;
    if (typeof va === 'object' && va !== null && !(va instanceof LosslessNumber)) return 0;
    return direction * naturalCompare(lower(va) as string, lower(vb) as string);
  });
}

const sorted = (items: unknown[], itemPath: JSONPath, direction: 1 | -1) => {
  const order = exactOrder(items, reordering(items, librarySort(items, itemPath, direction))!, {
    itemPath: () => itemPath,
    direction,
  });
  return order.map((i) => items[i]);
};

const ids = () =>
  parserFor('json').parse(
    '[1e400, -12345678901234567890, 5, 12345678901234567891, 0.1000000000000000000001, ' +
      '12345678901234567890, 0.1]',
  ) as unknown[];

describe('exactOrder', () => {
  it("sorts criterion 3's numbers by exact value, both ways", () => {
    const text = (items: unknown[]) => parserFor('json').stringify(items);
    expect(text(sorted(ids(), [], 1))).toBe(
      '[-12345678901234567890,0.1,0.1000000000000000000001,5,12345678901234567890,' +
        '12345678901234567891,1e400]',
    );
    expect(text(sorted(ids(), [], -1))).toBe(
      '[1e400,12345678901234567891,12345678901234567890,5,0.1000000000000000000001,0.1,' +
        '-12345678901234567890]',
    );
  });

  it('sorts records by a nested property and keeps every other kind where the library put it', () => {
    const records = parserFor('json').parse(
      '[{"id": 12345678901234567891, "n": "b"}, {"id": "x"}, {"id": 9007199254740993},' +
        ' {"id": 12345678901234567890}, {"id": true}, {"n": 1}, {"id": 7}, {"id": "B"},' +
        ' {"id": {"o": 1}}, {"id": "a"}]',
    ) as unknown[];
    expect(parserFor('json').stringify(sorted(records, ['id'], 1))).toBe(
      '[{"id":true},{"id":7},{"id":9007199254740993},{"id":12345678901234567890},' +
        '{"id":12345678901234567891,"n":"b"},{"id":"a"},{"id":"B"},{"id":"x"},{"id":{"o":1}},' +
        '{"n":1}]',
    );
  });

  it('is stable: equal values keep their order, 1e20 and 100000000000000000000 included', () => {
    const items = parserFor('json').parse(
      '[{"v": 100000000000000000000, "i": 0}, {"v": 1e20, "i": 1}, {"v": 5, "i": 2},' +
        ' {"v": 100000000000000000000, "i": 3}]',
    ) as unknown[];
    expect(sorted(items, ['v'], 1).map((x) => (x as { i: number }).i)).toEqual([2, 0, 1, 3]);
    expect(sorted(items, ['v'], -1).map((x) => (x as { i: number }).i)).toEqual([0, 1, 3, 2]);
  });

  // For random arrays of mixed numbers, the order equals sorting their exact values (BigInt
  // arithmetic, criterion 3's property), whatever order the library gave.
  it('orders random mixed numbers by exact value', () => {
    const decimal = fc
      .tuple(fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }), fc.integer({ min: 0, max: 25 }))
      .map(([digits, scale]) => ({ digits, scale }));
    fc.assert(
      fc.property(fc.array(decimal, { maxLength: 30 }), fc.boolean(), (values, descending) => {
        const text = (d: { digits: bigint; scale: number }) => `${d.digits}e-${d.scale}`;
        const items = values.map((d) => parserFor('json').parse(text(d)));
        const direction = descending ? -1 : 1;
        const order = exactOrder(items, reordering(items, librarySort(items, [], direction))!, {
          itemPath: () => [],
          direction,
        });
        const scaled = (d: { digits: bigint; scale: number }) => d.digits * 10n ** BigInt(25 - d.scale);
        const expected = values
          .map((d, i) => ({ v: scaled(d), i }))
          .sort((a, b) => (a.v === b.v ? a.i - b.i : (a.v < b.v ? -1 : 1) * direction))
          .map((x) => x.i);
        expect(order).toEqual(expected);
        for (let i = 1; i < order.length; i++) {
          const a = items[order[i - 1]!] as number | LosslessNumber;
          const b = items[order[i]!] as number | LosslessNumber;
          expect(compareNumbers(a, b) * direction).toBeLessThanOrEqual(0);
        }
      }),
      { seed: 15004, numRuns: 1000 },
    );
  });
});

describe('the property a sort asks for', () => {
  it('reads a table column back from its header name', () => {
    expect(columnPath('id', [{ id: 1 }], parseJSONPath)).toEqual(['id']);
    expect(columnPath('address.city', [], parseJSONPath)).toEqual(['address', 'city']);
    expect(columnPath('["a.b"][2]', [], parseJSONPath)).toEqual(['a.b', '2']);
    expect(columnPath('values', [1, new EditorNumber('1e400')], parseJSONPath)).toEqual([]);
    expect(columnPath('values', [{ values: 1 }, { values: 2 }], parseJSONPath)).toEqual([
      'values',
    ]);
  });

  it("takes the dialog's only choice when it shows no property select", () => {
    expect(onlyNestedPath([new EditorNumber('1e400'), 5])).toEqual([]);
    expect(onlyNestedPath([{ a: { b: new EditorNumber('1') } }, { a: { b: 2 } }])).toEqual([
      'a',
      'b',
    ]);
    expect(onlyNestedPath([])).toEqual([]);
  });
});
