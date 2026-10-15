import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSmartFormatCases } from './smart-format.js';

describe('loadSmartFormatCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string>): string {
    if (root) rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), 'smart-format-'));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const tags = '{"layout": ["inline"]}';
  const json5Case = {
    'json5/b/input.json5': '\uFEFF{a: 1}\r\n',
    'json5/b/expected.json5': '\uFEFF{a: 1}\r\n',
    'json5/b/case.json': tags,
  };
  const jsonCase = {
    'json/a/input.json': '[1,2]',
    'json/a/expected.json': '[1, 2]',
    'json/a/case.json': tags,
  };

  it('returns each case with its bytes unchanged, in format order', () => {
    expect(loadSmartFormatCases(corpus({ ...json5Case, ...jsonCase }))).toEqual([
      {
        format: 'json',
        name: 'a',
        input: '[1,2]',
        expected: '[1, 2]',
        tags: { layout: ['inline'] },
        options: {},
      },
      {
        format: 'json5',
        name: 'b',
        input: '\uFEFF{a: 1}\r\n',
        expected: '\uFEFF{a: 1}\r\n',
        tags: { layout: ['inline'] },
        options: {},
      },
    ]);
  });

  it('reads options.json as the case options (spec 019 T4)', () => {
    const [c] = loadSmartFormatCases(
      corpus({ ...jsonCase, 'json/a/options.json': '{ "maxLineLength": 60 }\n' }),
    );
    expect(c!.options).toEqual({ maxLineLength: 60 });
  });

  it.each([
    ['{', /options.json is not valid JSON/],
    ['[]', /options.json must be/],
    ['{}', /options.json must be/],
    ['{"maxLineLength": 19}', /options.json must be/],
    ['{"maxLineLength": 1001}', /options.json must be/],
    ['{"maxLineLength": 60.5}', /options.json must be/],
    ['{"maxLineLength": "60"}', /options.json must be/],
    ['{"maxLineLength": 60, "indent": 4}', /options.json must be/],
  ])('rejects options.json %s', (text, error) => {
    expect(() =>
      loadSmartFormatCases(corpus({ ...jsonCase, 'json/a/options.json': text })),
    ).toThrow(error);
  });

  it('rejects unknown folders, stray files and incomplete cases', () => {
    expect(() => loadSmartFormatCases(corpus({ ...jsonCase, 'yaml/x/input.yaml': '' }))).toThrow(
      /unknown entry yaml/,
    );
    expect(() => loadSmartFormatCases(corpus({ ...jsonCase, 'json/notes.txt': '' }))).toThrow(
      /files outside a case: notes.txt/,
    );
    expect(() =>
      loadSmartFormatCases(corpus({ ...jsonCase, 'json/a/expected.jsonc': '' })),
    ).toThrow(/unexpected file expected.jsonc/);
    const noExpected = Object.fromEntries(
      Object.entries(jsonCase).filter(([file]) => file !== 'json/a/expected.json'),
    );
    expect(() => loadSmartFormatCases(corpus(noExpected))).toThrow(/missing expected.json/);
    expect(() => loadSmartFormatCases(corpus({ ...jsonCase, 'json/a/case.json': '[]' }))).toThrow(
      /case.json must be an object/,
    );
    expect(() => loadSmartFormatCases(corpus({ ...jsonCase, 'json/a/case.json': '{' }))).toThrow(
      /case.json is not valid JSON/,
    );
  });
});
