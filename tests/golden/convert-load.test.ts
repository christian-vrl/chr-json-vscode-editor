import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertPairs, loadConvertCases } from './convert.js';

describe('conversion corpus', () => {
  const cases = loadConvertCases();

  it.each(convertPairs)('has at least one %s case', (pair) => {
    expect(cases.some((c) => c.pair === pair)).toBe(true);
  });
});

describe('loadConvertCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string>): string {
    root = mkdtempSync(path.join(tmpdir(), 'convert-'));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const validCase = {
    'jsonc-to-json/a/input.jsonc': '{"a": 1 // x\r\n}',
    'jsonc-to-json/a/expected.json': '{"a": 1\r\n}',
    'jsonc-to-json/a/losses.json': '[{"kind": "comment", "offset": 8, "length": 3}]',
    'jsonc-to-json/a/case.json': '{"rules": ["C5"], "location": "root"}',
  };

  it('returns {pair, from, to, name, input, expected, losses, tags} with bytes unchanged', () => {
    expect(loadConvertCases(corpus(validCase))).toEqual([
      {
        pair: 'jsonc-to-json',
        from: 'jsonc',
        to: 'json',
        name: 'a',
        input: '{"a": 1 // x\r\n}',
        expected: '{"a": 1\r\n}',
        losses: [{ kind: 'comment', offset: 8, length: 3 }],
        tags: { rules: ['C5'], location: 'root' },
      },
    ]);
  });

  it('names the case and file when a file is missing', () => {
    const files = Object.fromEntries(
      Object.entries(validCase).filter(([file]) => !file.endsWith('expected.json')),
    );
    expect(() => loadConvertCases(corpus(files))).toThrow(
      'conversion case jsonc-to-json/a: cannot read expected.json',
    );
  });

  it.each([
    ['a loss with no kind', '[{"offset": 0, "length": 1}]'],
    ['a value loss with no path', '[{"kind": "value", "offset": 0, "length": 3}]'],
    ['a comment loss with a path', '[{"kind": "comment", "offset": 0, "length": 3, "path": ""}]'],
    ['an empty loss', '[{"kind": "comment", "offset": 0, "length": 0}]'],
    ['an object', '{}'],
  ])('rejects %s in losses.json', (_, losses) => {
    const files = { ...validCase, 'jsonc-to-json/a/losses.json': losses };
    expect(() => loadConvertCases(corpus(files))).toThrow(
      'conversion case jsonc-to-json/a: losses.json must be an array',
    );
  });

  it('rejects a folder that is not a pair, such as a misspelled one', () => {
    const files = { ...validCase, 'jsonc-to-jsn/b/input.jsonc': '1' };
    expect(() => loadConvertCases(corpus(files))).toThrow(
      'conversion corpus: unknown entry jsonc-to-jsn',
    );
  });

  it('rejects a file directly inside a pair folder', () => {
    const files = { ...validCase, 'jsonc-to-json/input.jsonc': '1' };
    expect(() => loadConvertCases(corpus(files))).toThrow(
      'conversion corpus: jsonc-to-json/ holds files outside a case: input.jsonc',
    );
  });
});
