import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadJsonlCases } from './jsonl.js';

function without(files: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([file]) => file !== name));
}

describe('loadJsonlCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string>): string {
    if (root) rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), 'jsonl-'));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const patchCase = {
    'a/input.jsonl': '﻿1\r\n',
    'a/patch.json': '[{"op": "remove", "path": "/0"}]',
    'a/expected.jsonl': '﻿',
    'a/case.json': '{"rules": ["L4"], "op": "remove", "location": "item"}',
  };
  const parseCase = {
    'b/input.jsonl': '{\n',
    'b/data.json': '[]',
    'b/diagnostics.json':
      '[{"severity": "error", "message": "Line 1 is not valid JSON.", "offset": 0, "length": 1}]',
    'b/case.json': '{"rules": ["L1"]}',
  };
  const repairCase = {
    'c/input.jsonl': '[1,\n',
    'c/expected.jsonl': '[1]\n',
    'c/unrepaired.json': '[]',
    'c/case.json': '{"rules": ["L10"]}',
  };

  it('returns each kind of case with its bytes unchanged, sorted by name', () => {
    expect(loadJsonlCases(corpus({ ...repairCase, ...parseCase, ...patchCase }))).toEqual([
      {
        kind: 'patch',
        name: 'a',
        input: '﻿1\r\n',
        patch: [{ op: 'remove', path: '/0' }],
        expected: '﻿',
        tags: { rules: ['L4'], op: 'remove', location: 'item' },
      },
      {
        kind: 'parse',
        name: 'b',
        input: '{\n',
        data: [],
        diagnostics: [
          { severity: 'error', message: 'Line 1 is not valid JSON.', offset: 0, length: 1 },
        ],
        tags: { rules: ['L1'] },
      },
      {
        kind: 'repair',
        name: 'c',
        input: '[1,\n',
        expected: '[1]\n',
        unrepaired: [],
        tags: { rules: ['L10'] },
      },
    ]);
  });

  it('reads error cases, with or without a message', () => {
    const base = without(patchCase, 'a/expected.jsonl');
    expect(loadJsonlCases(corpus({ ...base, 'a/error.json': '{}' }))[0]).toMatchObject({
      error: {},
    });
    expect(
      loadJsonlCases(corpus({ ...base, 'a/error.json': '{"message": "no"}' }))[0],
    ).toMatchObject({ error: { message: 'no' } });
    expect(() => loadJsonlCases(corpus({ ...base, 'a/error.json': '{"line": 1}' }))).toThrow(
      'JSON Lines case a: error.json must be {} or {"message": "..."}',
    );
  });

  it('rejects stray files, missing files and mixed kinds', () => {
    expect(() => loadJsonlCases(corpus({ ...patchCase, 'notes.txt': '' }))).toThrow(
      'JSON Lines corpus: files outside a case: notes.txt',
    );
    expect(() => loadJsonlCases(corpus(without(patchCase, 'a/input.jsonl')))).toThrow(
      'JSON Lines case a: cannot read input.jsonl',
    );
    expect(() => loadJsonlCases(corpus(without(patchCase, 'a/patch.json')))).toThrow(
      'JSON Lines case a: must hold exactly one of patch.json, data.json, unrepaired.json',
    );
    expect(() => loadJsonlCases(corpus({ ...patchCase, 'a/unrepaired.json': '[]' }))).toThrow(
      'JSON Lines case a: must hold exactly one of',
    );
    expect(() => loadJsonlCases(corpus({ ...patchCase, 'a/error.json': '{}' }))).toThrow(
      'JSON Lines case a: must hold one of expected.jsonl and error.json',
    );
    expect(() => loadJsonlCases(corpus({ ...parseCase, 'b/expected.json': '[]' }))).toThrow(
      'JSON Lines case b: unexpected expected.json',
    );
    expect(() => loadJsonlCases(corpus(without(repairCase, 'c/expected.jsonl')))).toThrow(
      'JSON Lines case c: cannot read expected.jsonl',
    );
  });

  it('rejects malformed patches, diagnostics and line numbers', () => {
    expect(() =>
      loadJsonlCases(corpus({ ...patchCase, 'a/patch.json': '[{"op": "add"}]' })),
    ).toThrow('JSON Lines case a: patch.json must be an array of {op, path} operations');
    expect(() =>
      loadJsonlCases(corpus({ ...parseCase, 'b/diagnostics.json': '[{"message": "x"}]' })),
    ).toThrow('JSON Lines case b: diagnostics.json must be an array');
    expect(() => loadJsonlCases(corpus({ ...repairCase, 'c/unrepaired.json': '[0]' }))).toThrow(
      'JSON Lines case c: unrepaired.json must be an array of 1-based line numbers',
    );
  });
});
