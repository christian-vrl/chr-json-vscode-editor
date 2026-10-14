// Spec 017 (017 T2): the importer's edges that the golden corpus leaves to T2 (corpus README,
// readings 6 and "Not in the corpus") and criterion 4's hostile inputs.
import { describe, expect, it } from 'vitest';
import { importData, IMPORT_OUTPUT_STYLE, stringify, type ImportKind } from '../src/index.js';
import { locateValues } from '../src/import/toml.js';
import { YAML_DEPTH_MESSAGE } from '../src/import/yaml.js';

const A5 = 'The file is nested too deeply to convert (more than 1,000 levels)';

function text(input: string, kind: ImportKind): string {
  const result = importData(input, kind);
  if ('error' in result) throw new Error(`unexpected error ${JSON.stringify(result.error)}`);
  return stringify(result.data, 'json', { ...IMPORT_OUTPUT_STYLE, indent: 0, finalNewline: false });
}

const warnings = (input: string, kind: ImportKind) => {
  const result = importData(input, kind);
  if ('error' in result) throw new Error(`unexpected error ${JSON.stringify(result.error)}`);
  return result.warnings;
};

const error = (input: string, kind: ImportKind) => {
  const result = importData(input, kind);
  if (!('error' in result)) throw new Error('expected an error');
  return result.error;
};

/** `levels` nested containers of each kind, the root one counted as level 1 (reading 6). */
const nested = {
  yaml: (levels: number) => '['.repeat(levels) + ']'.repeat(levels),
  yamlBlock: (levels: number) =>
    Array.from({ length: levels - 1 }, (_, i) => `${' '.repeat(i)}a:`).join('\n') + ' {}',
  // The root table, then levels - 1 arrays.
  toml: (levels: number) => `a = ${'['.repeat(levels - 1)}${']'.repeat(levels - 1)}`,
  // The XM1 object, then levels - 1 elements that hold an element.
  xml: (levels: number) => '<a>'.repeat(levels) + '</a>'.repeat(levels),
};

describe('A5 depth', () => {
  it('converts 1,000 levels of TOML and XML and stops at 1,001', () => {
    expect(text(nested.toml(1000), 'toml')).toMatch(/^\{"a":\[\[/);
    expect(text(nested.xml(1000), 'xml')).toMatch(/^\{"a":\{"a":/);
    expect(error(nested.toml(1001), 'toml')).toEqual({ message: A5, line: 1 });
    expect(error(nested.xml(1001), 'xml')).toEqual({ message: A5, line: 1 });
  });

  it('counts an XML element with attributes as a level', () => {
    // 998 elements that hold one are levels 2 to 999; the element with an attribute is level 1,000.
    expect(text('<a>'.repeat(998) + '<a x="1"/>' + '</a>'.repeat(998), 'xml')).toContain('"@x":1');
    expect(error('<a>'.repeat(999) + '<a x="1"/>' + '</a>'.repeat(999), 'xml').message).toBe(A5);
  });

  it('converts 500 levels of YAML and stops at 501 with the YAML limit', () => {
    expect(text(nested.yaml(500), 'yaml')).toMatch(/^\[\[/);
    expect(text(nested.yamlBlock(500), 'yaml')).toMatch(/^\{"a":/);
    expect(error(nested.yaml(501), 'yaml')).toEqual({ message: YAML_DEPTH_MESSAGE, line: 1 });
    expect(error(nested.yamlBlock(501), 'yaml')).toEqual({ message: YAML_DEPTH_MESSAGE, line: 1 });
    expect(error(nested.yaml(1001), 'yaml')).toEqual({ message: A5, line: 1 });
  });

  it('counts the levels aliases add to YAML data', () => {
    const deep = `a: &a ${nested.yaml(300)}\nb: [${'[*a]'.repeat(1)}]\nc: ${'['.repeat(201)}*a${']'.repeat(201)}\n`;
    expect(error(deep, 'yaml').message).toBe(YAML_DEPTH_MESSAGE);
  });

  it('gives A5 for 100,000 nested levels of each kind, with no stack overflow (criterion 4)', () => {
    expect(error(nested.yaml(100_000), 'yaml')).toEqual({ message: A5, line: 1 });
    expect(error('['.repeat(100_000), 'yaml')).toEqual({ message: A5, line: 1 });
    expect(error(nested.toml(100_000), 'toml')).toEqual({ message: A5, line: 1 });
    expect(error(`a = ${'['.repeat(100_000)}`, 'toml')).toEqual({ message: A5, line: 1 });
    expect(error(`a = ${'{b = '.repeat(100_000)}1${'}'.repeat(100_000)}`, 'toml')).toEqual({
      message: A5,
      line: 1,
    });
    expect(error(nested.xml(100_000), 'xml')).toEqual({ message: A5, line: 1 });
  });
});

describe('criterion 4: bombs', () => {
  it('stops nine levels of nine YAML aliases in under 1 s (Y6)', () => {
    const lines = ['a: &a ["lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol", "lol"]'];
    for (const [prev, name] of [...'abcdefgh'].map((c, i) => [c, 'bcdefghi'[i]!]))
      lines.push(`${name}: &${name} [${Array(9).fill(`*${prev}`).join(', ')}]`);
    const start = performance.now();
    expect(error(lines.join('\n'), 'yaml')).toEqual({
      message: "The YAML file's aliases expand too far",
      line: 1,
    });
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('allows aliases that add up to 1,000,000 values, and no more', () => {
    // `a` is 10 values; each later array holds ten aliases of the one before, so `b` adds 100, `c`
    // 1,010, `d` 10,110, `e` 101,110 and `f` 1,011,110 values.
    const lines = ['a: &a [0, 0, 0, 0, 0, 0, 0, 0, 0]'];
    for (const [prev, name] of [...'abcde'].map((c, i) => [c, 'bcdef'[i]!]))
      lines.push(`${name}: &${name} [${Array(10).fill(`*${prev}`).join(', ')}]`);
    expect(text(lines.slice(0, 5).join('\n'), 'yaml').length).toBeGreaterThan(100_000);
    expect(error(lines.join('\n'), 'yaml').message).toBe("The YAML file's aliases expand too far");
  });

  it('keeps a DOCTYPE "billion laughs" unexpanded in under 1 s (XM7)', () => {
    const entities = ['<!ENTITY lol "lol">'];
    for (let i = 1; i <= 9; i++)
      entities.push(`<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`);
    const input = `<!DOCTYPE lolz [\n${entities.join('\n')}\n]>\n<lolz>&lol9;</lolz>`;
    const start = performance.now();
    expect(text(input, 'xml')).toBe('{"lolz":"&lol9;"}');
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('A1', () => {
  it('rejects UTF-32 byte order marks decoded as UTF-8', () => {
    const decode = (bytes: number[]) =>
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(bytes));
    for (const kind of ['yaml', 'toml', 'xml'] as const) {
      expect(error(decode([0xff, 0xfe, 0, 0, 0x61, 0, 0, 0]), kind).message).toBe(
        'Only UTF-8 files can be converted',
      );
      expect(error(decode([0, 0, 0xfe, 0xff, 0, 0, 0, 0x61]), kind).message).toBe(
        'Only UTF-8 files can be converted',
      );
    }
  });

  it('accepts an XML declaration naming UTF-8 in any case', () => {
    expect(text('<?xml version="1.0" encoding="UTF-8"?><a>1</a>', 'xml')).toBe('{"a":1}');
    expect(error('<?xml version="1.0" encoding="utf-16"?><a/>', 'xml').message).toBe(
      'Only UTF-8 files can be converted',
    );
  });
});

describe('YAML', () => {
  it('writes the integer -0 as -0 and the float -0.0 as -0', () => {
    expect(text('a: -0\nb: -0.0\nc: 0\n', 'yaml')).toBe('{"a":-0,"b":-0,"c":0}');
  });

  it('drops YAML 1.1 separators in floats and keeps 1.1 timestamps and keys as written', () => {
    expect(text('%YAML 1.1\n---\na: 1_000.5\nyes: 2001-12-14\n', 'yaml')).toBe(
      '{"a":1000.5,"yes":"2001-12-14"}',
    );
  });

  it('lists an integer-like key first, as every JavaScript object does', () => {
    // A4's file order cannot hold here: data members are object properties, which list integer
    // keys first (corpus README, "Not in the corpus").
    expect(text('b: 1\n"1": 2\n', 'yaml')).toBe('{"1":2,"b":1}');
  });

  it('names a non-finite root value with the empty JSON Pointer', () => {
    expect(warnings('.inf\n', 'yaml')).toEqual([
      { message: ': .inf has no JSON form; written as null', line: 1 },
    ]);
  });

  it('counts a tag used through an alias once', () => {
    expect(warnings('a: &x !Ref b\nc: *x\nd: *x\n', 'yaml')).toEqual([
      { message: 'Tag !Ref was ignored (1 place)', line: 1 },
    ]);
  });

  it('reads an ignored tag on a plain scalar as untagged', () => {
    expect(text('a: !Ref 12\nb: !Ref "12"\nc: !!timestamp 2001-12-14\n', 'yaml')).toBe(
      '{"a":12,"b":"12","c":"2001-12-14"}',
    );
  });

  it('gives an error for an alias to an unknown anchor', () => {
    expect(error('a: 1\nb: *nope\n', 'yaml')).toMatchObject({ line: 2, column: 4 });
  });

  it('warns about a repeated key only when it is written twice, not when it is merged', () => {
    expect(warnings('x: &x {a: 1}\ny:\n  a: 2\n  <<: *x\n', 'yaml')).toEqual([]);
    expect(text('x: &x {a: 1}\ny:\n  a: 2\n  <<: *x\n', 'yaml')).toBe('{"x":{"a":1},"y":{"a":2}}');
  });
});

describe('TOML', () => {
  it('writes the integer -0 as 0 and the float -0.0 as -0', () => {
    // `smol-toml` 1.9.0 gives the integer -0 as the number 0 (TOML 1.0.0: -0 and +0 are 0); only
    // the float keeps its sign (TM3). Pinned at the #122 review's request.
    expect(text('a = -0\nb = -0.0\nc = +0\n', 'toml')).toBe('{"a":0,"b":-0,"c":0}');
  });

  it('finds values under arrays of tables, inline tables, dotted and quoted keys', () => {
    const input = [
      'x.y = inf',
      '"q.k" = { z = [1, nan], "w" = -inf }',
      '[[t]]',
      'v = 1',
      '[[t]]',
      '[t.s]',
      'v = 1979-05-27 07:32:00Z # comment',
      '[[t.u]]',
      "n = '''a",
      "b''' # not a value",
      'm = +inf',
    ].join('\n');
    const at = (path: string) => locateValues(input).get(path);
    expect(at('/x/y')).toEqual({ offset: 6, text: 'inf' });
    expect(at('/q.k/z/1')?.text).toBe('nan');
    expect(at('/q.k/w')?.text).toBe('-inf');
    expect(at('/t/0/v')?.text).toBe('1');
    expect(at('/t/1/s/v')?.text).toBe('1979-05-27 07:32:00Z');
    expect(at('/t/1/u/0/m')?.text).toBe('+inf');
    expect(warnings(input, 'toml')).toEqual([
      { message: '/x/y: inf has no JSON form; written as null', line: 1 },
      { message: '/q.k/z/1: nan has no JSON form; written as null', line: 2 },
      { message: '/q.k/w: -inf has no JSON form; written as null', line: 2 },
      { message: '/t/1/u/0/m: +inf has no JSON form; written as null', line: 11 },
    ]);
  });

  it('names the first integer outside 64 bits in the file, as written (TM2)', () => {
    expect(
      error('[b]\nc = 0x1_0000_0000_0000_0000\n[a]\nd = -9223372036854775809\n', 'toml'),
    ).toEqual({
      message: 'Integer 0x1_0000_0000_0000_0000 is outside the 64-bit range TOML allows',
      line: 2,
      column: 5,
    });
  });
});

describe('XML', () => {
  it('warns once about an unknown entity in an attribute and in text', () => {
    expect(text('<a x="&e;">&e; &f;</a>', 'xml')).toBe('{"a":{"@x":"&e;","#text":"&e; &f;"}}');
    expect(warnings('<a x="&e;">&e; &f;</a>', 'xml')).toEqual([
      { message: 'Entity &e; was not expanded and is kept as written', line: 1 },
      { message: 'Entity &f; was not expanded and is kept as written', line: 1 },
    ]);
  });

  it('gives an error for a text with no root element', () => {
    expect(error('<!-- nothing -->', 'xml')).toMatchObject({ line: 1 });
  });
});
