// The library's `parser` prop backed by core (003 T5, criterion 10).
import { describe, expect, it } from 'vitest';
import { parserFor } from '../src/parser.js';

describe('parserFor', () => {
  it('reads JSONC comments and trailing commas as data', () => {
    expect(parserFor('jsonc').parse('{\n  // c\n  "a": [1, 2,], /* d */\n}')).toEqual({
      a: [1, 2],
    });
  });

  it('reads JSON5 syntax', () => {
    expect(parserFor('json5').parse("{a: 'b', h: 0x10, n: +1,}")).toEqual({ a: 'b', h: 16, n: 1 });
  });

  it('keeps warnings for JSON (comments are strict-JSON warnings, not errors)', () => {
    expect(parserFor('json').parse('{"a": 1 // c\n}')).toEqual({ a: 1 });
  });

  it.each([
    ['json', '{"a": }'],
    ['jsonc', '[1 2'],
    // 002 T5 F1: a JSON5 syntax error gives data undefined and one error diagnostic.
    ['json5', '{a: }'],
    ['json5', ''],
  ] as const)('throws for %s that does not parse: %j', (format, text) => {
    expect(() => parserFor(format).parse(text)).toThrow(SyntaxError);
  });

  it('stringifies like JSON.stringify and returns one parser per format', () => {
    expect(parserFor('json5').stringify({ a: [1] }, null, 2)).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(parserFor('jsonc')).toBe(parserFor('jsonc'));
    expect(parserFor('jsonc')).not.toBe(parserFor('json'));
  });
});
