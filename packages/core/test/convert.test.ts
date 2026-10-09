// `convert` (006 T2) beyond the golden corpus and the property suite: a source with an error is not
// converted (spec 006 criterion 7 relies on it), and the edges of C5 and C6 the corpus has no case for.
import { describe, expect, it } from 'vitest';
import { convert, ConvertError } from '../src/index.js';

describe('convert', () => {
  it('throws a ConvertError with the first error when the source does not parse', () => {
    expect(() => convert('{"a": }', 'jsonc', 'json')).toThrow(ConvertError);
    expect(() => convert("{a: 'x'", 'json5', 'json')).toThrow(ConvertError);
    expect(() => convert('{"a": 1,}', 'json', 'json5')).not.toThrow();
    let error: unknown;
    try {
      convert('[1, oops]', 'json5', 'jsonc');
    } catch (e) {
      error = e;
    }
    expect((error as ConvertError).diagnostic).toMatchObject({ severity: 'error', offset: 4 });
  });

  it('returns the text unchanged for the same format', () => {
    const text = '{a: 0x1, /* c */}';
    expect(convert(text, 'json5', 'json5')).toEqual({ text, losses: [] });
  });

  it('removes the white space before a comment back to a removed trailing comma only', () => {
    expect(convert('[1 , // x\n]', 'jsonc', 'json').text).toBe('[1 \n]');
  });

  it('removes white space C6 rewrote when a comment follows it', () => {
    expect(convert('[1, \t/* x */ 2]', 'json5', 'json').text).toBe('[1, 2]');
  });

  it('removes a line left blank by a comment and a trailing comma together', () => {
    expect(convert('[\n  1\n  , // x\n]\n', 'jsonc', 'json').text).toBe('[\n  1\n]\n');
  });

  it('writes U+2028 outside a string as the majority line ending, and keeps it in a string', () => {
    const text = '{\r\n"a": 1, "b": "x y"\r\n}';
    expect(convert(text, 'json5', 'jsonc').text).toBe('{\r\n"a": 1,\r\n"b": "x y"\r\n}');
  });

  it('gives the pointer of a non-finite number in an array, and "" at the root', () => {
    expect(convert('[1, [NaN]]', 'json5', 'json').losses).toEqual([
      { kind: 'value', offset: 5, length: 3, path: '/1/0' },
    ]);
    expect(convert('+Infinity', 'json5', 'jsonc')).toEqual({
      text: 'null',
      losses: [{ kind: 'value', offset: 0, length: 9, path: '' }],
    });
  });
});
