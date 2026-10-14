// `smartFormat` (010 T2) on cases the golden corpus leaves out (README "Not in the corpus") and on
// the FracturedJson 5.1.0 behaviour its passes work around.
import { describe, expect, it } from 'vitest';
import {
  detectStyle,
  PatchError,
  smartFormat,
  SMART_FORMAT_MAX_LINE_LENGTH,
  type SmartFormatFormat as Format,
} from '../src/index.js';

describe('smartFormat', () => {
  it('returns a text with no value unchanged (criterion 5)', () => {
    for (const text of ['', '  \n', '// only a comment\n', '\uFEFF/* a */', '\r\n\r\n'])
      for (const format of ['json', 'jsonc', 'json5'] as const)
        expect(smartFormat(text, format)).toBe(text);
  });

  it('throws a PatchError on a text with a parse error (criterion 9)', () => {
    expect(() => smartFormat('{"a": }', 'json')).toThrow(PatchError);
    expect(() => smartFormat('[1, 2', 'jsonc')).toThrow(PatchError);
    expect(() => smartFormat('{a: 1,, }', 'json5')).toThrow(PatchError);
    // JSON5 syntax is an error in JSONC.
    expect(() => smartFormat("{'a': 1}", 'jsonc')).toThrow(PatchError);
  });

  it('formats a .json file with comments and trailing commas (warnings), dropping only the commas', () => {
    expect(smartFormat('{"a": [1, 2,], // two\n"b": 3,}\n', 'json')).toBe(
      '{\n  "a": [1, 2],  // two\n  "b": 3\n}\n',
    );
  });

  it('keeps duplicate keys, __proto__ and -0', () => {
    expect(smartFormat('{"a": 1, "a": 2, "__proto__": -0}', 'json')).toBe(
      '{"a": 1, "a": 2, "__proto__": -0}',
    );
  });

  it('keeps the BOM, CRLF and the missing final newline', () => {
    expect(smartFormat('\uFEFF{\r\n    "a": [1,\r\n 2]\r\n}', 'json')).toBe(
      '\uFEFF{ "a": [1, 2] }',
    );
    expect(smartFormat('\uFEFF[\r\n    {"a": 1}, // x\r\n    2\r\n]', 'jsonc')).toBe(
      '\uFEFF[\r\n    {"a": 1},  // x\r\n    2\r\n]',
    );
  });

  it('keeps a line comment that holds */ or ends in white space, byte for byte', () => {
    // FracturedJson ends a line comment at `*/` and trims the white space at its end.
    expect(smartFormat('[1, // a */ b\n2]', 'jsonc')).toBe('[\n  1,  // a */ b\n  2\n]');
    expect(smartFormat('[1, // a  \t\n2]', 'jsonc')).toBe('[\n  1,  // a  \t\n  2\n]');
  });

  it('keeps the empty lines of a block comment', () => {
    // FracturedJson drops them; only the leading white space of later lines may change.
    expect(smartFormat('[1, /* a\n\n   b */ 2]', 'jsonc')).toBe(
      '[\n  1,\n  /* a\n\n  b */\n  2\n]',
    );
    expect(smartFormat('[1, /* a\r\n\r\n   b */ 2]\r\n', 'jsonc')).toBe(
      '[\r\n  1,\r\n  /* a\r\n\r\n  b */\r\n  2\r\n]\r\n',
    );
    // FracturedJson drops every `\r` and splits on `\n` only: `\n\r` is one empty line, a lone
    // `\r` or U+2028 a line end.
    for (const format of ['jsonc', 'json5'] as const) {
      expect(smartFormat('[1, /* a\n\r b */ 2]', format)).toBe('[\n  1,\n  /* a\n\n  b */\n  2\n]');
      expect(smartFormat('[1, /* a\r b c */ 2]', format)).toBe(
        '[\n  1,\n  /* a\n  b\n  c */\n  2\n]',
      );
    }
  });

  it('keeps private-use characters of the document apart from its stand-ins', () => {
    const text = "{'\uE000': '\uE000\uE001\uE002\uE003', b: \"\uE003\uE004\"}";
    expect(smartFormat(text, 'json5')).toBe(text);
    expect(smartFormat('["\uE000\uE001", "\uE0001\uE001"]', 'json')).toBe(
      '["\uE000\uE001", "\uE0001\uE001"]',
    );
  });

  it('reads JSON5 white space and line terminators as layout', () => {
    expect(smartFormat("{a: 1,\u2028b:\u00A0'x', // c\u2029d: 2}", 'json5')).toBe(
      "{\n  a: 1,\n  b: 'x',  // c\n  d: 2\n}",
    );
  });

  it('measures a JSON5 token at its written width (L7)', () => {
    // Stand-ins are longer than `0x1` and `.5`; at their own width the row still fits.
    const text = `[${Array.from({ length: 40 }, (_, i) => (i % 2 ? '0x1' : '.5')).join(', ')}]`;
    const out = smartFormat(text, 'json5');
    expect(out.split('\n').length).toBe(4);
    expect(out.split('\n')[1]!.length).toBeGreaterThan(100);
    expect(Math.max(...out.split('\n').map((l) => l.length))).toBeLessThanOrEqual(120);
  });

  it('keeps strings holding U+007F–U+009F, which FracturedJson rejects', () => {
    for (const format of ['json', 'jsonc', 'json5'] as const)
      expect(smartFormat('["a\u0085b",  "\u007F"]', format)).toBe('["a\u0085b", "\u007F"]');
  });

  it('keeps lines within 120 columns where FracturedJson undercounts them (criterion 6)', () => {
    const width = (out: string) =>
      Math.max(...out.split('\n').map((l) => l.replace(/\t/g, '    ').length));
    const cases: [string, Format][] = [
      // An inline value padded to its siblings' middle-comment column.
      [
        `{"aa": /* c */ 1, "b": [${[1, 2, 3, 4, 5, 6, 7].map((d) => String(d).repeat(10)).join(', ')}, ${'8'.repeat(19)}]}`,
        'json',
      ],
      // A trailing comma put back after an inline value that ends a multi-line container.
      [
        '{"pos":[31283/* c38 */,1.6337620484071437e-283,5.226719701247259e-47,5.1607545638687e-122,1e+21,20086]/* c39 */,}',
        'jsonc',
      ],
      // A tab inside a comment counted as 4 columns.
      [
        '/**/[[[486609954781e-88,15838/* c6 */,45251],[20327,0.000021234888705341218/* c7 */,33491]],// c5  \t\n[/**/{}\n       ]]',
        'json5',
      ],
    ];
    for (const [text, format] of cases) {
      const out = smartFormat(text, format);
      expect(width(out), out).toBeLessThanOrEqual(120);
      expect(smartFormat(out, format)).toBe(out);
    }
    expect(smartFormat(cases[1]![0], 'jsonc')).toContain('], /* c39 */\n}');
  });

  it('adds a trailing comma back only where the closing bracket starts a line (L6, reading 7)', () => {
    expect(smartFormat('{"a": [1, 2,],\n "b": {"c": 1,\n},\n}\n', 'jsonc')).toBe(
      '{ "a": [1, 2], "b": {"c": 1} }\n',
    );
    expect(smartFormat('{\n  // x\n  "a": [1, 2,],\n  "b": 1,\n}\n', 'jsonc')).toBe(
      '{\n  // x\n  "a": [1, 2],\n  "b": 1,\n}\n',
    );
  });
  describe('maxLineLength (spec 019 F1)', () => {
    const text = '{"a": [1, 2, 3, 4, 5, 6, 7, 8]}';

    it('defaults to 120 columns', () => {
      expect(SMART_FORMAT_MAX_LINE_LENGTH).toBe(120);
      expect(smartFormat(text, 'json')).toBe(smartFormat(text, 'json', { maxLineLength: 120 }));
      expect(smartFormat(text, 'json', {})).toBe('{ "a": [1, 2, 3, 4, 5, 6, 7, 8] }');
    });

    it('lays out to the given length', () => {
      expect(smartFormat(text, 'json', { maxLineLength: 30 })).toBe(
        '{\n  "a": [\n    1, 2, 3, 4, 5, 6, 7, 8\n  ]\n}',
      );
      expect(smartFormat(text, 'json', { maxLineLength: 20 })).toBe(
        '{\n  "a": [\n    1, 2, 3, 4, 5,\n    6, 7, 8\n  ]\n}',
      );
    });
  });
});

describe('detectStyle on aligned columns (criteria 4 and 5)', () => {
  it('reads the unit through padded keys, table rows and right-aligned numbers', () => {
    // Smart format pads a key or a row whose siblings have a comment before them.
    expect(detectStyle('{\n  /* c */ "id" : 1,\n           "a b": 2\n}', 'jsonc').indent).toBe(2);
    expect(detectStyle('[\n   /* c */ {"y": 1},\n             {"y": 2}\n]', 'jsonc').indent).toBe(
      3,
    );
    // A compact array whose rows all start with a padded number.
    expect(detectStyle('[\n      1, 100,   2,\n      3,   4\n]', 'json').indent).toBe(4);
    expect(detectStyle('{\n\t"a": [\n\t\t  1, 100,\n\t\t  2,   3\n\t]\n}', 'json').indent).toBe(
      '\t',
    );
    // ... after the column of the comments some items have before them.
    expect(
      detectStyle('[\n            1.5,   100, /* c */   3,\n           44,     5\n]', 'jsonc')
        .indent,
    ).toBe(2);
  });

  it('reads a value moved below its key one level deeper', () => {
    expect(
      detectStyle('{\n  "a":\n    /* c\n    d */\n    [\n      1\n    ]\n}', 'jsonc').indent,
    ).toBe(2);
  });

  it('still reads ordinary documents as before', () => {
    expect(detectStyle('{\n    "a": {\n        "b": 1\n    }\n}', 'json').indent).toBe(4);
    expect(detectStyle('[\n  1,\n  22\n]', 'json').indent).toBe(2);
    expect(detectStyle('{"a": [1, 2]}', 'json').indent).toBe(2);
  });
});
