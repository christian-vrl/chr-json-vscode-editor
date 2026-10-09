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
});

describe('convertedName', () => {
  it('replaces the last extension', () => {
    expect(convertedName('data.json5', 'json')).toBe('data.json');
    expect(convertedName('a.b.json', 'jsonc')).toBe('a.b.jsonc');
    expect(convertedName('tsconfig.json', 'json')).toBe('tsconfig.json');
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
