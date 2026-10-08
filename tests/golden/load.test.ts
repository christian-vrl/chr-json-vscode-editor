import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { goldenFormats, loadGoldenCases } from './load.js';

describe('golden corpus', () => {
  const cases = loadGoldenCases();

  it('has at least three cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(goldenFormats)('has at least one %s case', (format) => {
    expect(cases.some((c) => c.format === format)).toBe(true);
  });

  it.each(cases.map((c) => [`${c.format}/${c.name}`, c] as const))(
    '%s loads every field',
    (_, c) => {
      expect(c.input.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(0);
      expect(c.patch.length).toBeGreaterThan(0);
      expect(typeof c.tags.op).toBe('string');
    },
  );
});

describe('loadGoldenCases', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function corpus(files: Record<string, string>): string {
    root = mkdtempSync(path.join(tmpdir(), 'golden-'));
    for (const format of goldenFormats) mkdirSync(path.join(root, format));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  }

  const validCase = {
    'jsonc/a/input.jsonc': '{\r\n  "a": 1 // x\r\n}',
    'jsonc/a/expected.jsonc': '{\r\n  "a": 2 // x\r\n}',
    'jsonc/a/patch.json': '[{"op": "replace", "path": "/a", "value": 2}]',
    'jsonc/a/case.json': '{"op": "replace", "location": "root"}',
  };

  it('returns {format, name, input, patch, expected, tags} with bytes unchanged', () => {
    expect(loadGoldenCases(corpus(validCase))).toEqual([
      {
        format: 'jsonc',
        name: 'a',
        input: '{\r\n  "a": 1 // x\r\n}',
        patch: [{ op: 'replace', path: '/a', value: 2 }],
        expected: '{\r\n  "a": 2 // x\r\n}',
        tags: { op: 'replace', location: 'root' },
      },
    ]);
  });

  it('sorts cases by format, then name', () => {
    const files: Record<string, string> = {
      ...validCase,
      'json/b/input.json': '1',
      'json/b/expected.json': '2',
      'json/b/patch.json': '[{"op": "replace", "path": "", "value": 2}]',
      'json/b/case.json': '{"op": "replace"}',
    };
    for (const [file, text] of Object.entries(validCase)) {
      files[file.replace('jsonc/a/', 'jsonc/0/')] = text;
    }
    const names = loadGoldenCases(corpus(files)).map((c) => `${c.format}/${c.name}`);
    expect(names).toEqual(['json/b', 'jsonc/0', 'jsonc/a']);
  });

  it('names the case and file when a file is missing', () => {
    const files = Object.fromEntries(
      Object.entries(validCase).filter(([file]) => file !== 'jsonc/a/expected.jsonc'),
    );
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden case jsonc/a: cannot read expected.jsonc',
    );
  });

  it('rejects a patch that is not a list of operations', () => {
    const files = { ...validCase, 'jsonc/a/patch.json': '{"op": "replace", "path": "/a"}' };
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden case jsonc/a: patch.json must be an array of {op, path} operations',
    );
  });

  it('rejects case.json without an op tag', () => {
    const files = { ...validCase, 'jsonc/a/case.json': '{"location": "root"}' };
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden case jsonc/a: case.json must be an object with a string "op" tag',
    );
  });

  it('rejects a folder that is not a format, such as a misspelled one', () => {
    const files = { ...validCase, 'jscon/b/input.jsonc': '1' };
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden corpus: unknown folder jscon (formats: json, jsonc, json5)',
    );
  });

  it('accepts files beside the format folders', () => {
    const files = { ...validCase, 'load.ts': '', 'tags.json': '{}' };
    expect(loadGoldenCases(corpus(files))).toHaveLength(1);
  });

  it('rejects a file directly inside a format folder', () => {
    const files = { ...validCase, 'jsonc/input.jsonc': '1' };
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden corpus: jsonc/ holds files outside a case: input.jsonc',
    );
  });

  it('rejects invalid JSON in case.json', () => {
    const files = { ...validCase, 'jsonc/a/case.json': '{op: replace}' };
    expect(() => loadGoldenCases(corpus(files))).toThrow(
      'golden case jsonc/a: case.json is not valid JSON',
    );
  });
});
