import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { csvOptionErrors, loadCsvCases } from './csv.js';

function without(files: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([file]) => file !== name));
}

describe('loadCsvCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string>): string {
    root = mkdtempSync(path.join(tmpdir(), 'csv-'));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const exportCase = {
    'export/a/input.json': '[{"a": 1}]',
    'export/a/options.json': '{"delimiter": ";"}',
    'export/a/expected.csv': '\uFEFFa\r\n1\r\n',
    'export/a/case.json': '{"rules": ["X1"]}',
  };
  const importCase = {
    'import/b/input.csv': '\uFEFFa\r\n1\r\n',
    'import/b/options.json': '{}',
    'import/b/expected.json': '[{"a": 1}]',
    'import/b/warnings.json': '[{"message": "w", "line": 2}]',
    'import/b/case.json': '{"rules": ["I1"]}',
  };

  it('returns each case with its bytes unchanged, export first', () => {
    expect(loadCsvCases(corpus({ ...importCase, ...exportCase }))).toEqual([
      {
        direction: 'export',
        name: 'a',
        input: [{ a: 1 }],
        options: { delimiter: ';' },
        expected: '\uFEFFa\r\n1\r\n',
        tags: { rules: ['X1'] },
      },
      {
        direction: 'import',
        name: 'b',
        input: '\uFEFFa\r\n1\r\n',
        options: {},
        expected: [{ a: 1 }],
        warnings: [{ message: 'w', line: 2 }],
        tags: { rules: ['I1'] },
      },
    ]);
  });

  it('reads error cases', () => {
    const cases = loadCsvCases(
      corpus({
        'export/a/input.json': '1',
        'export/a/options.json': '{}',
        'export/a/error.json': '{"message": "no"}',
        'export/a/case.json': '{"rules": ["X1"]}',
        'import/b/input.csv': '',
        'import/b/options.json': '{}',
        'import/b/error.json': '{"message": "empty", "line": 1}',
        'import/b/case.json': '{"rules": ["I2"]}',
      }),
    );
    expect(cases.map((c) => c.error)).toEqual([{ message: 'no' }, { message: 'empty', line: 1 }]);
  });

  it('rejects unknown folders, stray files and incomplete or mixed cases', () => {
    expect(() => loadCsvCases(corpus({ ...exportCase, 'exports/x/input.json': '1' }))).toThrow(
      /unknown entry exports/,
    );
    rmSync(root!, { recursive: true });
    expect(() => loadCsvCases(corpus({ ...exportCase, 'export/notes.txt': '' }))).toThrow(
      /files outside a case: notes.txt/,
    );
    rmSync(root!, { recursive: true });
    expect(() =>
      loadCsvCases(corpus({ ...exportCase, 'export/a/error.json': '{"message": "x"}' })),
    ).toThrow(/needs expected.csv, or error.json, but not both/);
    rmSync(root!, { recursive: true });
    expect(() => loadCsvCases(corpus(without(importCase, 'import/b/warnings.json')))).toThrow(
      /needs expected.json and warnings.json/,
    );
    rmSync(root!, { recursive: true });
    expect(() => loadCsvCases(corpus({ ...importCase, 'import/b/expected.csv': '' }))).toThrow(
      /unexpected file expected.csv/,
    );
  });

  it('rejects malformed messages', () => {
    expect(() =>
      loadCsvCases(corpus({ ...importCase, 'import/b/warnings.json': '[{"message": "w"}]' })),
    ).toThrow(/each warning must be \{"message", "line"\}/);
    rmSync(root!, { recursive: true });
    expect(() =>
      loadCsvCases(
        corpus({
          ...without(exportCase, 'export/a/expected.csv'),
          'export/a/error.json': '{"message": "x", "line": 1}',
        }),
      ),
    ).toThrow(/error.json must be \{"message"\}/);
  });
});

describe('csvOptionErrors', () => {
  it('accepts each direction own options', () => {
    expect(csvOptionErrors('export', { delimiter: '\t', bom: true, flattenArrays: true })).toEqual(
      [],
    );
    expect(csvOptionErrors('import', { delimiter: '|', nestedObjects: false })).toEqual([]);
  });

  it('rejects other options, unknown delimiters and non-boolean switches', () => {
    expect(csvOptionErrors('import', { bom: true, delimiter: 'detect', header: 'no' })).toEqual([
      'has unknown option "bom"',
      'has unknown delimiter "detect"',
      'option "header" must be true or false',
    ]);
    expect(csvOptionErrors('export', { delimiter: ':' })).toEqual(['has unknown delimiter ":"']);
    expect(csvOptionErrors('export', [])).toEqual(['must be an object']);
  });
});
