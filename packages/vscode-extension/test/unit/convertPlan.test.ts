// Unit checks for what 006 T3's convert commands write and say (convertPlan.ts), against the real
// core. The e2e suite (test/e2e/convert.cjs) runs the commands in VS Code.
import { describe, expect, it } from 'vitest';
import { brokenMessage, convertedName, lossQuestion, plan } from '../../src/convertPlan';

const BOM = '﻿';

describe('plan', () => {
  it('converts, keeping the losses of core', () => {
    expect(plan('{\n  // c\n  "a": 1,\n}\n', 'jsonc', 'json')).toEqual({
      kind: 'converted',
      text: '{\n  "a": 1\n}\n',
      losses: [{ kind: 'comment', offset: 4, length: 4 }],
    });
  });

  it('says when the target is the source format', () => {
    expect(plan('{}', 'json5', 'json5')).toEqual({ kind: 'same' });
  });

  it('reports a broken source with the offset of its error', () => {
    const result = plan('{\n  "a": }', 'json', 'jsonc');
    expect(result).toMatchObject({ kind: 'broken', offset: 9 });
  });

  // #60 Reviewer note F1: a leading BOM is the file's encoding mark, kept in front of the result.
  it.each([
    ['json', 'jsonc', '{"a": 1}', '{"a": 1}'],
    ['json', 'json5', '{"a": 1}', '{"a": 1}'],
    ['jsonc', 'json', '{"a": 1, // c\n}', '{"a": 1\n}'],
    ['jsonc', 'json5', '{"a": 1, // c\n}', '{"a": 1, // c\n}'],
    ['json5', 'json', "{a: 'x',}", '{"a": "x"}'],
    ['json5', 'jsonc', "{a: 'x',}", '{"a": "x",}'],
  ] as const)('%s to %s keeps a leading BOM in the text', (from, to, input, output) => {
    const result = plan(BOM + input, from, to);
    expect(result).toMatchObject({ kind: 'converted', text: BOM + output });
  });

  it('adds the BOM of the source file when the text has none', () => {
    expect(plan('{"a": 1}', 'json', 'json5', true)).toMatchObject({ text: `${BOM}{"a": 1}` });
    expect(plan(`${BOM}{"a": 1}`, 'json', 'json5', true)).toMatchObject({ text: `${BOM}{"a": 1}` });
  });

  it('gives offsets in the text with its BOM', () => {
    expect(plan(`${BOM}[NaN]`, 'json5', 'json')).toMatchObject({
      losses: [{ kind: 'value', offset: 2, length: 3, path: '/0' }],
    });
    expect(plan(`${BOM}{,}`, 'json', 'json5')).toMatchObject({ kind: 'broken', offset: 2 });
  });

  // Spec 012 criterion 9 (J1, J2).
  it('converts to and from JSON Lines', () => {
    expect(plan('[{"a": 1},\n 2]\n', 'json', 'jsonl')).toEqual({
      kind: 'converted',
      text: '{"a":1}\n2\n',
      losses: [],
    });
    expect(plan(`${BOM}{"a":1}\r\n2\r\n`, 'jsonl', 'json')).toEqual({
      kind: 'converted',
      text: `${BOM}[\r\n  {"a":1},\r\n  2\r\n]\r\n`,
      losses: [],
    });
  });

  it('refuses a root that is not an array as JSON Lines, apart from a broken source', () => {
    expect(plan('{"a": 1}', 'json', 'jsonl')).toEqual({ kind: 'not-array' });
    expect(plan('{a: 1} // c', 'json5', 'jsonl')).toEqual({ kind: 'not-array' });
    expect(plan('[1,', 'json', 'jsonl')).toMatchObject({ kind: 'broken' });
    expect(plan('{"a":1}\n{"b":\n', 'jsonl', 'json')).toMatchObject({ kind: 'broken', offset: 8 });
  });
});

describe('convertedName', () => {
  it('replaces the last extension', () => {
    expect(convertedName('data.json5', 'json')).toBe('data.json');
    expect(convertedName('a.b.json', 'jsonc')).toBe('a.b.jsonc');
    expect(convertedName('tsconfig.json', 'json')).toBe('tsconfig.json');
    expect(convertedName('data.json', 'jsonl')).toBe('data.jsonl');
    expect(convertedName('log.ndjson', 'json5')).toBe('log.json5');
  });

  it('adds one to a name without', () => {
    expect(convertedName('Untitled', 'json5')).toBe('Untitled.json5');
    expect(convertedName('.babelrc', 'json')).toBe('.babelrc.json');
  });
});

describe('messages', () => {
  it('gives the position of a broken source (#60 Reviewer note F2)', () => {
    expect(brokenMessage('json5', 'json', 3, 7)).toBe(
      "CHR JSON Editor: can't convert to JSON: the document is not valid JSON5 (error at line 3, " +
        'column 7). Fix it or run "Repair JSON" first.',
    );
  });

  it('names "Repair Lines" for a JSON Lines source (spec 012 criterion 9)', () => {
    expect(brokenMessage('jsonl', 'json5', 2, 1)).toBe(
      "CHR JSON Editor: can't convert to JSON5: the document is not valid JSON Lines (error at " +
        'line 2, column 1). Fix it or run "Repair Lines" first.',
    );
  });

  it('counts the comments and lists the values by path', () => {
    const text = '{\n  // one\n  a: NaN, /* two */\n  b: [-Infinity],\n  c: Infinity\n}';
    const result = plan(text, 'json5', 'json');
    if (result.kind !== 'converted') throw new Error(result.kind);
    expect(lossQuestion(text, 'json', result.losses)).toEqual({
      message:
        'Converting to JSON removes 2 comments and changes 3 values to null. Convert anyway?',
      detail: '/a: NaN → null\n/b/0: -Infinity → null\n/c: Infinity → null',
    });
  });

  it('names the root and a single loss', () => {
    expect(
      lossQuestion('NaN', 'jsonc', [{ kind: 'value', offset: 0, length: 3, path: '' }]),
    ).toEqual({
      message: 'Converting to JSONC changes 1 value to null. Convert anyway?',
      detail: '(root): NaN → null',
    });
    expect(lossQuestion('1 // c', 'json', [{ kind: 'comment', offset: 2, length: 4 }])).toEqual({
      message: 'Converting to JSON removes 1 comment. Convert anyway?',
      detail: '',
    });
  });
});
