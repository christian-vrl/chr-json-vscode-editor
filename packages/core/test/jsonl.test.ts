// The `jsonl` adapter (spec 012, 012 T2) beyond the golden corpus: the tree and style of L1 and L2,
// the readings of tests/golden/README.md that the corpus cannot hold, the other `FormatAdapter`
// actions (§Other `FormatAdapter` actions), and `parseData('jsonl')` (criterion 10's 008 criterion 6).
import { describe, expect, it } from 'vitest';
import {
  convert,
  getAdapter,
  parseData,
  PatchError,
  repair,
  type FormatNode,
} from '../src/index.js';

const jsonl = getAdapter('jsonl');
const BOM = '﻿';

/** The text a node spans. */
const span = (text: string, node: FormatNode) => text.slice(node.offset, node.offset + node.length);

describe('parse (L1, L2)', () => {
  it('gives an array node over the whole text whose children are the items, offsets into the text', () => {
    const text = `${BOM}{"a": [1, 2]}\r\n\r\n  "s"\t\r\n7`;
    const { tree, data } = jsonl.parse(text);
    expect(data).toEqual([{ a: [1, 2] }, 's', 7]);
    expect(tree).toMatchObject({ type: 'array', offset: 0, length: text.length });
    expect(tree!.children!.map((node) => span(text, node))).toEqual(['{"a": [1, 2]}', '"s"', '7']);
    const property = tree!.children![0]!.children![0]!;
    expect(property.type).toBe('property');
    expect(span(text, property.children![1]!)).toBe('[1, 2]');
  });

  it('reads an empty text as an empty array with a tree, not an error', () => {
    expect(jsonl.parse('')).toMatchObject({
      data: [],
      tree: { type: 'array', offset: 0, length: 0, children: [] },
      diagnostics: [],
    });
  });

  it.each([
    ['', '\n', true],
    ['1', '\n', false],
    ['1\r\n2\n', '\r\n', true],
    ['\n1\r\n', '\n', true],
    ['  \t', '\n', false],
  ] as const)('style of %j: eol %j, final newline %s (L2)', (text, eol, finalNewline) => {
    expect(jsonl.parse(text).style).toEqual({
      indent: 0,
      eol,
      finalNewline,
      quote: '"',
      unquotedKeys: false,
      trailingCommas: false,
    });
  });

  it('reads a one-line text as one item, not as the array JSON.parse would give', () => {
    expect(jsonl.parse('[1, 2]').data).toEqual([[1, 2]]);
  });

  it('keeps a `__proto__` key as a member and reads duplicate keys as the json adapter does', () => {
    const [item] = jsonl.parse('{"__proto__": 1, "a": 1, "a": 2}\n').data as object[];
    expect(Object.keys(item!)).toEqual(['__proto__', 'a']);
    expect(item).toEqual(getAdapter('json').parse('{"__proto__": 1, "a": 1, "a": 2}').data);
  });

  it('caches the parse of the last text (UNK-014)', () => {
    const text = '{"a":1}\n';
    expect(jsonl.parse(text)).toBe(jsonl.parse(text));
  });
});

describe('applyPatch readings (tests/golden/README.md, JSON Lines)', () => {
  it('9: removing a last line with no ending after an empty line takes the empty line too', () => {
    expect(jsonl.applyPatch('{"a":1}\n\n2', [{ op: 'remove', path: '/1' }])).toBe('{"a":1}\n');
    expect(jsonl.applyPatch('\n2', [{ op: 'remove', path: '/0' }])).toBe('');
    // In one patch, as in two.
    expect(
      jsonl.applyPatch('\n[] ', [
        { op: 'remove', path: '/0' },
        { op: 'add', path: '/-', value: 1 },
      ]),
    ).toBe('1\n');
    // A blank line with spaces stays (L4: blank lines stay).
    expect(jsonl.applyPatch('1\n \n2', [{ op: 'remove', path: '/1' }])).toBe('1\n ');
  });

  it("10: a move that takes away the text's only line ending writes it back", () => {
    expect(jsonl.applyPatch('1\r\n2', [{ op: 'move', from: '/0', path: '/1' }])).toBe('2\r\n1');
  });

  it('adds after the blank lines of a text with no item, with a final newline per L2 (L3)', () => {
    expect(jsonl.applyPatch('\r\n\r\n', [{ op: 'add', path: '/-', value: 1 }])).toBe(
      '\r\n\r\n1\r\n',
    );
    expect(jsonl.applyPatch(' ', [{ op: 'add', path: '/0', value: 1 }])).toBe(' \n1');
    expect(jsonl.applyPatch(BOM, [{ op: 'add', path: '/0', value: 1 }])).toBe(`${BOM}1\n`);
  });

  it('keeps the BOM first when the first item moves or is removed (reading 4)', () => {
    expect(jsonl.applyPatch(`${BOM}1\n2\n`, [{ op: 'move', from: '/1', path: '/0' }])).toBe(
      `${BOM}2\n1\n`,
    );
    expect(jsonl.applyPatch(`${BOM}1\n2\n`, [{ op: 'remove', path: '/0' }])).toBe(`${BOM}2\n`);
  });

  it('carries value bytes between items: numbers beyond double precision stay as written (L7)', () => {
    const text = '{"n":12345678901234567890}\n{"m":1}\n';
    expect(jsonl.applyPatch(text, [{ op: 'copy', from: '/0/n', path: '/1/n' }])).toBe(
      '{"n":12345678901234567890}\n{"m":1, "n": 12345678901234567890}\n',
    );
    expect(jsonl.applyPatch(text, [{ op: 'move', from: '/0/n', path: '/-' }])).toBe(
      '{}\n{"m":1}\n12345678901234567890\n',
    );
    expect(jsonl.applyPatch(text, [{ op: 'move', from: '/1', path: '/0/m' }])).toBe(
      '{"n":12345678901234567890, "m": {"m":1}}\n',
    );
  });

  it('carries bytes into an item that already holds the placeholder text', () => {
    const marker = JSON.stringify('\u0000chr-json-editor');
    const text = `[${marker}]\n2\n`;
    expect(jsonl.applyPatch(text, [{ op: 'copy', from: '/1', path: '/0/0' }])).toBe(
      `[2, ${marker}]\n2\n`,
    );
  });

  it('copies the root as a new item and tests the root', () => {
    expect(jsonl.applyPatch('1\n2\n', [{ op: 'copy', from: '', path: '/-' }])).toBe(
      '1\n2\n[1,2]\n',
    );
    expect(jsonl.applyPatch('1\n', [{ op: 'test', path: '', value: [1] }])).toBe('1\n');
    expect(() => jsonl.applyPatch('1\n', [{ op: 'test', path: '', value: [2] }])).toThrow(
      PatchError,
    );
  });

  it('refuses paths that name no item, moves into themselves and values that are not JSON', () => {
    const refused = [
      { op: 'add', path: '/3', value: 1 },
      { op: 'add', path: '/01', value: 1 },
      { op: 'replace', path: '/-', value: 1 },
      { op: 'remove', path: '/2' },
      { op: 'add', path: '/0/a/b', value: 1 },
      { op: 'move', from: '/0', path: '/0/a' },
      { op: 'move', from: '', path: '/0' },
      { op: 'copy', from: '/0/x', path: '/-' },
      { op: 'add', path: '/-', value: undefined },
      { op: 'unknown', path: '/0' },
    ] as const;
    for (const op of refused) {
      expect(() => jsonl.applyPatch('{"a":1}\n2\n', [op as never]), JSON.stringify(op)).toThrow(
        PatchError,
      );
    }
  });

  it('is atomic: a failing operation leaves nothing applied (L9, R9)', () => {
    const text = '1\n2\n';
    expect(() =>
      jsonl.applyPatch(text, [
        { op: 'remove', path: '/0' },
        { op: 'test', path: '/0', value: 3 },
      ]),
    ).toThrow(PatchError);
    expect(jsonl.parse(text).data).toEqual([1, 2]);
  });
});

describe('the other FormatAdapter actions (spec 012 §Other)', () => {
  const style = jsonl.parse('').style;

  it('stringify writes one item per line, final newline per style; [] is ""', () => {
    expect(jsonl.stringify([{ a: 1 }, 'x', [1, 2]], style)).toBe('{"a":1}\n"x"\n[1,2]\n');
    expect(jsonl.stringify([1, 2], { ...style, eol: '\r\n', finalNewline: false })).toBe('1\r\n2');
    expect(jsonl.stringify([], style)).toBe('');
    expect(jsonl.stringify(['line\nbreak'], style)).toBe('"line\\nbreak"\n');
  });

  it('stringify throws a TypeError for data that is not an array or holds a non-finite number', () => {
    for (const data of [{}, 1, null, 'x', [NaN], [{ a: [Infinity] }], [undefined]]) {
      expect(() => jsonl.stringify(data, style), JSON.stringify(data)).toThrow(TypeError);
    }
  });

  it('sort of the root reorders whole lines; blank lines and endings keep their place (R13)', () => {
    const text = '  {"n":3} \n\n{"n":1}\r\n{ "n": 2 }';
    expect(jsonl.sort(text, { property: '/n' })).toBe('{"n":1}\n\n{ "n": 2 }\r\n  {"n":3} ');
    expect(jsonl.sort(text, { order: [2, 1, 0] })).toBe('{ "n": 2 }\n\n{"n":1}\r\n  {"n":3} ');
    expect(jsonl.sort('1\n2\n')).toBe('1\n2\n');
    expect(() => jsonl.sort('1\n2\n', { order: [0, 0] })).toThrow(PatchError);
  });

  it('a nested sort sorts inside one item (L7)', () => {
    expect(jsonl.sort('1\n{"b":1, "a":2}\n', { path: '/1' })).toBe('1\n{"a":2, "b":1}\n');
    expect(jsonl.sort('[3,1,2]\n', { path: '/0', direction: 'desc' })).toBe('[3,2,1]\n');
    expect(() => jsonl.sort('1\n', { path: '/0' })).toThrow(PatchError);
    expect(() => jsonl.sort('1\n', { path: '/1' })).toThrow(PatchError);
  });

  it('compact compacts each item; blank lines and line endings stay (R12)', () => {
    expect(jsonl.compact(' { "a" : [1, 2] } \r\n\r\n[ ]')).toBe('{"a":[1,2]}\r\n\r\n[]');
  });

  it('prettyPrint is not available', () => {
    expect(() => jsonl.prettyPrint('1\n')).toThrow(
      new PatchError('Format is not available for JSON Lines.'),
    );
  });

  it('every action refuses a text with a bad line, naming it (L9)', () => {
    const text = '1\n{bad\n';
    for (const action of [
      () => jsonl.applyPatch(text, []),
      () => jsonl.sort(text),
      () => jsonl.compact(text),
    ]) {
      expect(action).toThrow(new PatchError('Line 2 is not valid JSON.'));
    }
  });
});

describe('parseData (spec 008 criterion 6 for JSON Lines)', () => {
  it.each([
    ['', { data: [] }],
    ['[1, 2]', { data: [[1, 2]] }],
    [`${BOM}{"a":1}\r\n\r\n2\n`, { data: [{ a: 1 }, 2] }],
    ['1\n{bad\n3\nx', { error: { message: 'Line 2 is not valid JSON.', offset: 2 } }],
    [`${BOM}{bad\n1\n`, { error: { message: 'Line 1 is not valid JSON.', offset: 0 } }],
    ['1\r2\n', { error: { message: 'Line 1 is not valid JSON.', offset: 0 } }],
  ])('parseData("jsonl", %j)', (text, result) => {
    expect(parseData('jsonl', text)).toEqual(result);
    const parsed = jsonl.parse(text);
    if ('data' in result) {
      expect(parsed.data).toEqual(result.data);
      expect(parsed.diagnostics).toEqual([]);
    } else {
      const first = parsed.diagnostics[0]!;
      expect({ message: first.message, offset: first.offset }).toEqual(result.error);
    }
  });
});

describe('until 012 T3', () => {
  it('Repair JSON and conversion do not take JSON Lines', () => {
    expect(() => repair('1\n{', 'jsonl')).toThrow(PatchError);
    expect(() => convert('1\n', 'jsonl', 'json')).toThrow('not available yet');
    expect(() => convert('[1]', 'json', 'jsonl')).toThrow('not available yet');
  });
});
