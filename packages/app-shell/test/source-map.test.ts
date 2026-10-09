// 004 T5: the json-source-map stand-in places a pointer's key and value in JSON, JSONC and JSON5
// text the way json-source-map does for JSON, so text mode underlines the right range.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/source-map.js';

// json-source-map ships no types.
const jsonSourceMap = createRequire(import.meta.url)('json-source-map') as {
  parse(text: string): { pointers: unknown };
};

const span = (text: string, from: number, to: number) => text.slice(from, to);

describe('source-map stand-in', () => {
  it('matches json-source-map on strict JSON', () => {
    const text = '{\n  "a": [1, {"b~/c": null}],\n  "d": "x"\n}\n';
    expect(parse(text).pointers).toEqual(jsonSourceMap.parse(text).pointers);
  });

  it('maps JSONC with comments and trailing commas', () => {
    const text = '{\n  // note\n  "name": "",\n  "age": 1.5, /* x */\n}\n';
    const { pointers } = parse(text);
    expect(span(text, pointers['/age']!.key!.pos, pointers['/age']!.keyEnd!.pos)).toBe('"age"');
    expect(span(text, pointers['/age']!.value.pos, pointers['/age']!.valueEnd.pos)).toBe('1.5');
    expect(pointers['/age']!.key).toEqual({ line: 3, column: 2, pos: text.indexOf('"age"') });
  });

  it('maps JSON5 with unquoted keys, single quotes and hex', () => {
    const text = "// c\n[{name: 'Ada', age: 0x2a,},]";
    const { data, pointers } = parse(text);
    expect(data).toEqual([{ name: 'Ada', age: 42 }]);
    expect(span(text, pointers['/0/age']!.key!.pos, pointers['/0/age']!.keyEnd!.pos)).toBe('age');
    expect(span(text, pointers['/0/name']!.value.pos, pointers['/0/name']!.valueEnd.pos)).toBe(
      "'Ada'",
    );
    expect(pointers['/0']!.key).toBeUndefined();
    expect(pointers['']!.value).toEqual({ line: 1, column: 0, pos: 5 });
  });

  it('throws on text that does not parse, as json-source-map does', () => {
    expect(() => parse('{"a": ')).toThrow(SyntaxError);
    expect(() => parse('')).toThrow(SyntaxError);
  });
});
