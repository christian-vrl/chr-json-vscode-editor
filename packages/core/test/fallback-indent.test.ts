// Unit tests for 019 T5 (spec 019 criterion 6, core part; UNK-088 ★): style detection says when a
// text has no indentation to follow, and every writer takes a fallback indent for it (`WriteOptions`)
// with 2 spaces when none is given, so the golden corpus is unchanged. R1: a one-line file gaining
// a multi-line object; R15: an empty document; a document with indentation keeps following it.
import { describe, expect, it } from 'vitest';
import {
  convert,
  detectStyle,
  getAdapter,
  indentUnit,
  smartFormat,
  stringify,
  type Format,
} from '../src/index.js';

const NESTED = { a: { b: [1] } };
const nested = (unit: string) =>
  `{\n${unit}"a": {\n${unit}${unit}"b": [\n${unit}${unit}${unit}1\n${unit}${unit}]\n${unit}}\n}`;

describe('detectStyle reports "no indentation found"', () => {
  it.each([
    ['a file with no line breaks', '{"a": [1, 2]}'],
    ['an empty document', ''],
    ['white space only', '  \n'],
    ['lines with no indentation', '{\n"a": 1\n}\n'],
  ])('%s: indent 2, indentFound false', (_, text) => {
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      expect(detectStyle(text, format)).toMatchObject({ indent: 2, indentFound: false });
    }
  });

  it.each([
    ['two spaces', '{\n  "a": 1\n}', 2],
    ['three spaces', '{\n   "a": 1\n}', 3],
    ['a tab', '{\n\t"a": 1\n}', '\t'],
  ] as const)('%s: found, no indentFound key', (_, text, indent) => {
    const style = detectStyle(text, 'json');
    expect(style.indent).toBe(indent);
    expect('indentFound' in style).toBe(false);
  });

  it('indentUnit takes the fallback only when no indentation was found', () => {
    expect(indentUnit(detectStyle('{"a": 1}', 'json'), 4)).toBe(4);
    expect(indentUnit(detectStyle('{"a": 1}', 'json'), '\t')).toBe('\t');
    expect(indentUnit(detectStyle('{"a": 1}', 'json'), undefined)).toBe(2);
    expect(indentUnit(detectStyle('{\n   "a": 1\n}', 'json'), 4)).toBe(3);
  });
});

describe.each(['json', 'jsonc', 'json5'] as const)('applyPatch in %s', (format: Format) => {
  const adapter = getAdapter(format);
  const replaceRoot = [{ op: 'replace', path: '', value: NESTED }] as const;
  // JSON5 writes the file's key style: `{a: 1}` has unquoted keys.
  const keys = (text: string) => (format === 'json5' ? text.replace(/"(\w)"/g, '$1') : text);
  const oneLine = keys('{"a": 1}');

  it('R1: a one-line file gaining a multi-line object, 2 spaces by default', () => {
    expect(adapter.applyPatch(oneLine, [...replaceRoot])).toBe(keys(nested('  ')));
  });

  it('R1: with 4 spaces and with a tab', () => {
    expect(adapter.applyPatch(oneLine, [...replaceRoot], { indent: 4 })).toBe(keys(nested('    ')));
    expect(adapter.applyPatch(oneLine, [...replaceRoot], { indent: '\t' })).toBe(
      keys(nested('\t')),
    );
  });

  it('R1: an empty container written over lines with no indentation gets the fallback', () => {
    // (JSON5 quotes the key: the file has no key to take a style from.)
    expect(adapter.applyPatch('{\n}', [{ op: 'add', path: '/a', value: 1 }], { indent: 4 })).toBe(
      '{\n    "a": 1\n}',
    );
  });

  it('R15: an empty document, with the final newline (no line break: `\\n`)', () => {
    // (JSON5 writes quoted keys here: the document has no key to take a style from.)
    const add = [{ op: 'add', path: '', value: NESTED }] as const;
    expect(adapter.applyPatch('', [...add])).toBe(`${nested('  ')}\n`);
    expect(adapter.applyPatch('', [...add], { indent: 4 })).toBe(`${nested('    ')}\n`);
    expect(adapter.applyPatch('', [...add], { indent: '\t' })).toBe(`${nested('\t')}\n`);
    // After comments, whatever their indentation, with the text's line ending.
    expect(adapter.applyPatch('// c\r\n   // d\r\n', [...add], { indent: '\t' })).toBe(
      `// c\r\n   // d\r\n${nested('\t').replace(/\n/g, '\r\n')}\r\n`,
    );
  });

  it('a document indented by 3 spaces keeps 3 (R1)', () => {
    const text = keys('{\n   "a": 1\n}');
    const patch = [{ op: 'add', path: '/b', value: { c: 1 } }] as const;
    expect(adapter.applyPatch(text, [...patch], { indent: 4 })).toBe(
      keys('{\n   "a": 1,\n   "b": {\n      "c": 1\n   }\n}'),
    );
    expect(adapter.applyPatch(text, [...patch], { indent: '\t' })).toBe(
      adapter.applyPatch(text, [...patch]),
    );
  });

  it('move in a file with no indentation keeps the fallback after the removal', () => {
    const text = keys('{\n"a": {"x": 1},\n"b": {\n}\n}');
    expect(
      adapter.applyPatch(text, [{ op: 'move', from: '/a', path: '/b/c' }], { indent: 4 }),
    ).toBe(keys('{\n"b": {\n    "c": {"x": 1}\n}\n}'));
  });

  it('Format (prettyPrint) lays out a one-line text with the fallback', () => {
    const text = keys('{"a": {"b": [1]}}');
    expect(adapter.prettyPrint(text)).toBe(keys(nested('  ')));
    expect(adapter.prettyPrint(text, { indent: 4 })).toBe(keys(nested('    ')));
    expect(adapter.prettyPrint(text, { indent: '\t' })).toBe(keys(nested('\t')));
    // An indented text keeps its unit.
    const three = keys('{\n   "a": {"b": [1]}}');
    expect(adapter.prettyPrint(three, { indent: 4 })).toBe(keys(nested('   ')));
  });

  it('stringify with a detected style takes the fallback; an explicit style is kept', () => {
    const detected = adapter.parse(oneLine).style;
    expect(adapter.stringify(NESTED, detected, { indent: 4 })).toBe(keys(nested('    ')));
    expect(stringify(NESTED, format, detected)).toBe(keys(nested('  ')));
    const explicit = { ...detected, indent: 3 } as const;
    delete (explicit as { indentFound?: false }).indentFound;
    expect(adapter.stringify(NESTED, explicit, { indent: 4 })).toBe(keys(nested('   ')));
  });
});

describe('convert JSON Lines → JSON (012 J1)', () => {
  const lines = '{"a": 1}\n[2, 3]\n';
  it('indents each item by two spaces by default, else by the fallback', () => {
    expect(convert(lines, 'jsonl', 'json').text).toBe('[\n  {"a": 1},\n  [2, 3]\n]\n');
    expect(convert(lines, 'jsonl', 'json', { indent: 4 }).text).toBe(
      '[\n    {"a": 1},\n    [2, 3]\n]\n',
    );
    expect(convert(lines, 'jsonl', 'jsonc', { indent: '\t' }).text).toBe(
      '[\n\t{"a": 1},\n\t[2, 3]\n]\n',
    );
  });
});

describe('smartFormat', () => {
  // Wider than 120 columns, so it is laid out over several lines.
  const items = Array.from({ length: 12 }, (_, i) => `{"id": ${i}, "name": "item ${i}"}`);
  const wide = `{"items": [${items.join(', ')}], "nested": {"deep": {"x": [1, 2, 3]}}}`;

  it('lays out a one-line text with 2 spaces by default and with the fallback when given', () => {
    const lines = (text: string) => text.split('\n').filter((l) => /^\s/.test(l));
    expect(lines(smartFormat(wide, 'json')).every((l) => /^ {2}(?: {2})*\S/.test(l))).toBe(true);
    const four = smartFormat(wide, 'json', { indent: 4 });
    expect(detectStyle(four, 'json').indent).toBe(4);
    expect(lines(four).every((l) => /^(?: {4})+\S/.test(l))).toBe(true);
    const tab = smartFormat(wide, 'jsonc', { indent: '\t' });
    expect(lines(tab).every((l) => /^\t+\S/.test(l))).toBe(true);
  });

  it('keeps the indentation of an indented text', () => {
    const text = `{\n   "a": [${items.join(', ')}]\n}`;
    expect(detectStyle(smartFormat(text, 'json', { indent: 4 }), 'json').indent).toBe(3);
  });
});
