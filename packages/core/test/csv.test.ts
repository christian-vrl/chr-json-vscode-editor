// 009 T2: cases of spec 009 the golden corpus cannot hold or leaves open (tests/golden/README.md
// §CSV corpus): X5 words for NaN and the infinities, the readings T2 takes and UNK-057–UNK-062.
import { describe, expect, it } from 'vitest';
import { csvToJson, detectDelimiter, jsonToCsv } from '../src/index.js';

const text = (data: unknown, options = {}) => {
  const result = jsonToCsv(data, options);
  if (!('text' in result)) throw new Error(result.error.message);
  return result.text;
};
const read = (csv: string, options = {}) => {
  const result = csvToJson(csv, options);
  if (!('data' in result)) throw new Error(JSON.stringify(result.error));
  return result;
};

describe('jsonToCsv', () => {
  it('writes NaN, Infinity and -Infinity as those words, unquoted (X5)', () => {
    expect(text([{ a: NaN, b: Infinity, c: -Infinity }])).toBe(
      'a,b,c\r\nNaN,Infinity,-Infinity\r\n',
    );
  });

  it('writes -0 as 0 (X5, JSON.stringify)', () => {
    expect(text([{ a: -0 }])).toBe('a\r\n0\r\n');
  });

  it('reads NaN and Infinity cells back as strings (I7)', () => {
    expect(read('a,b,c\r\nNaN,Infinity,-Infinity\r\n').data).toEqual([
      { a: 'NaN', b: 'Infinity', c: '-Infinity' },
    ]);
  });

  it('skips undefined members, as JSON.stringify does', () => {
    expect(text([{ a: 1, b: undefined }])).toBe('a\r\n1\r\n');
  });

  it.each([
    ['an empty array', [], ''],
    ['rows of {} only', [{}, {}], ''],
    ['an empty object', {}, ''],
    ['an empty array with the BOM on', [], '﻿'],
  ])('gives an empty text for %s: no column (UNK-057)', (_, data, expected) => {
    expect(text(data, { bom: expected !== '' })).toBe(expected);
  });

  it('spreads array items over [0], [1], … with "Flatten nested arrays" on (UNK-058)', () => {
    expect(text([[1, 2], [3], { a: 4 }], { flattenArrays: true })).toBe(
      '[0],[1],a\r\n1,2,\r\n3,,\r\n,,4\r\n',
    );
  });

  it('keeps an array item as one JSON cell in the "" column with "Flatten nested arrays" off', () => {
    expect(text([[1, 2], { a: 3 }])).toBe('"",a\r\n"[1,2]",\r\n,3\r\n');
  });

  it('quotes a header that reads back as a number but not one that reads back as text', () => {
    expect(text([{ '1': 1, '01': 2 }])).toBe('"1",01\r\n1,2\r\n');
  });
});

describe('csvToJson', () => {
  it('keeps a quoted or unquoted cell with white space around JSON text a string (reading 9)', () => {
    expect(read('v\r\n" [1]"\r\n"[1] "\r\n"{} "\r\n[1] \r\n').data).toEqual([
      { v: ' [1]' },
      { v: '[1] ' },
      { v: '{} ' },
      { v: '[1] ' },
    ]);
  });

  it('names the line of the closing quote when text follows it (reading 10)', () => {
    expect(read('a,b\r\n1,"x\r\ny"z\r\n').warnings).toEqual([
      { message: 'Text after a closing quote is kept as part of the field', line: 3 },
    ]);
  });

  it('keeps a field name holding " as a flat key (reading 5)', () => {
    expect(read('"a""b",a.c\r\n1,2\r\n').data).toEqual([{ 'a"b': 1, a: { c: 2 } }]);
  });

  it('reads a text of one line ending as one empty record', () => {
    expect(read('\r\n')).toEqual({ data: [], warnings: [] });
  });

  it('sets __proto__ as an own member, never the prototype', () => {
    const { data } = read('__proto__,x.__proto__,"[""__proto__""].a"\r\n1,2,3\r\n');
    const row = data[0]!;
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.keys(row)).toEqual(['__proto__', 'x', '["__proto__"].a']);
    expect(Object.getOwnPropertyDescriptor(row, '__proto__')!.value).toBe(1);
    expect(Object.getOwnPropertyDescriptor(row.x, '__proto__')!.value).toBe(2);
  });

  it('names every column up to the widest record with the header off, with no warning (UNK-059)', () => {
    expect(read('1\r\n2,3,4\r\n\r\n5,6\r\n', { header: false })).toEqual({
      data: [
        { 'Field 0': 1 },
        { 'Field 0': 2, 'Field 1': 3, 'Field 2': 4 },
        { 'Field 0': 5, 'Field 1': 6 },
      ],
      warnings: [],
    });
  });

  it('treats an empty line as a row of one column with the header off when no record is wider', () => {
    expect(read('1\r\n\r\n2\r\n', { header: false }).data).toEqual([
      { 'Field 0': 1 },
      { 'Field 0': null },
      { 'Field 0': 2 },
    ]);
  });

  it('renames left to right; the first use of a name wins (UNK-060)', () => {
    expect(read('a,a,a_1\r\n1,2,3\r\n')).toEqual({
      data: [{ a: 1, a_1: 2, a_1_1: 3 }],
      warnings: [
        { message: 'Field name "a" is repeated; this column is named "a_1"', line: 1 },
        { message: 'Field name "a_1" is repeated; this column is named "a_1_1"', line: 1 },
      ],
    });
  });

  it('renames an extra field whose "Field n" a header already uses (UNK-060)', () => {
    expect(read('Field 2,b\r\n1,2,3\r\n')).toEqual({
      data: [{ 'Field 2': 1, b: 2, 'Field 2_1': 3 }],
      warnings: [
        {
          message: 'Field name "Field 2" is repeated; this column is named "Field 2_1"',
          line: 2,
        },
        {
          message:
            'The record has more fields than there are field names; extra fields are kept as "Field 2_1"',
          line: 2,
        },
      ],
    });
  });

  it('renames a conflicting name whose flat key a nested member already holds (UNK-061)', () => {
    expect(read('a.b,a\r\n1,2\r\n')).toEqual({
      data: [{ a: { b: 1 }, a_1: 2 }],
      warnings: [
        { message: 'Field name "a" conflicts with "a.b"; it is kept as a flat key', line: 1 },
        { message: 'Field name "a" is repeated; this column is named "a_1"', line: 1 },
      ],
    });
  });

  it('flags a name that needs an array where an earlier one made an object', () => {
    expect(read('u.k,u[0]\r\n1,2\r\n').warnings).toEqual([
      { message: 'Field name "u[0]" conflicts with "u.k"; it is kept as a flat key', line: 1 },
    ]);
  });
});

describe('detectDelimiter (I3)', () => {
  it.each([
    ['a;b\r\n1;2\r\n', ';'],
    ['a\tb\r\n1\t2\r\n', '\t'],
    ['a|b\r\n1|2\r\n', '|'],
    ['a\r\n1\r\n', ','],
    ['', ','],
    ['﻿a;b\r\n1;2\r\n', ';'],
  ])('%j gives %j', (csv, expected) => {
    expect(detectDelimiter(csv)).toBe(expected);
  });

  it('does not count empty lines among the first 10 records (UNK-062)', () => {
    expect(detectDelimiter('a;b\r\n\r\n1;2\r\n\r\n')).toBe(';');
    expect(read('a;b\r\n\r\n1;2\r\n\r\n').data).toEqual([{ a: 1, b: 2 }]);
  });

  it('counts the records an open quote leaves before it', () => {
    expect(detectDelimiter('a;b\r\n1;2\r\n"open')).toBe(';');
  });
});
