import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadImportCases } from './import.js';

function without(files: Record<string, string | Uint8Array>, name: string) {
  return Object.fromEntries(Object.entries(files).filter(([file]) => file !== name));
}

describe('loadImportCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string | Uint8Array>): string {
    if (root) rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), 'import-'));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const okCase = {
    'yaml/a/input.yaml': '﻿a: 1\n',
    'yaml/a/case.json': '{"rules": ["A1"], "tags": ["bom"]}',
    'yaml/a/expected.json': '{\n  "a": 1\n}\n',
    'yaml/a/warnings.json': '[]',
  };
  const errorCase = {
    'xml/b/input.xml': new Uint8Array([0xff, 0xfe, 0x3c, 0x00]),
    'xml/b/case.json': '{"rules": ["A1"], "tags": []}',
    'xml/b/error.json': '{"message": "no", "line": 1}',
  };

  it('returns cases kind by kind with their bytes and decoded text, ignoring README.md', () => {
    const cases = loadImportCases(corpus({ ...errorCase, ...okCase, 'README.md': '# x' }));
    expect(cases.map((c) => `${c.kind}/${c.name}`)).toEqual(['yaml/a', 'xml/b']);
    expect(cases[0]).toMatchObject({
      input: '﻿a: 1\n',
      expected: '{\n  "a": 1\n}\n',
      warnings: [],
      tags: { rules: ['A1'], tags: ['bom'] },
    });
    expect(cases[1]!.bytes).toEqual(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]));
    expect(cases[1]).toMatchObject({ input: '��<\0', error: { message: 'no', line: 1 } });
  });

  it('rejects stray entries, missing files and both outcomes at once', () => {
    expect(() => loadImportCases(corpus({ ...okCase, 'json/x/input.json': '' }))).toThrow(
      'import corpus: unknown entry json (kinds: yaml, toml, xml)',
    );
    expect(() => loadImportCases(corpus({ ...okCase, 'yaml/notes.txt': '' }))).toThrow(
      'import corpus: yaml/ holds files outside a case: notes.txt',
    );
    expect(() => loadImportCases(corpus(without(okCase, 'yaml/a/input.yaml')))).toThrow(
      'import case yaml/a: cannot read input.yaml',
    );
    expect(() => loadImportCases(corpus(without(okCase, 'yaml/a/warnings.json')))).toThrow(
      'import case yaml/a: needs expected.json and warnings.json, or error.json, but not both',
    );
    expect(() =>
      loadImportCases(corpus({ ...okCase, 'yaml/a/error.json': '{"line": 1}' })),
    ).toThrow('but not both');
    expect(() => loadImportCases(corpus({ ...okCase, 'yaml/a/input.yml': '' }))).toThrow(
      'import case yaml/a: unexpected file input.yml',
    );
  });

  it('rejects malformed messages and expected files', () => {
    for (const bad of [
      '{"line": 0}',
      '{"message": "", "line": 1}',
      '{"line": 1, "column": 0}',
      '{"line": 1, "at": 2}',
    ]) {
      expect(() => loadImportCases(corpus({ ...errorCase, 'xml/b/error.json': bad }))).toThrow(
        'import case xml/b: error.json must be',
      );
    }
    expect(() =>
      loadImportCases(corpus({ ...okCase, 'yaml/a/warnings.json': '[{"message": "w"}]' })),
    ).toThrow('import case yaml/a: warnings.json must be an array of {"message", "line"}');
    expect(() => loadImportCases(corpus({ ...okCase, 'yaml/a/expected.json': '{' }))).toThrow(
      'import case yaml/a: expected.json is not valid JSON',
    );
  });
});
