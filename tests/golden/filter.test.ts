import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterFromEnv, selectGoldenCases } from './filter.js';
import type { GoldenCase } from './load.js';

const make = (format: GoldenCase['format'], op: string): GoldenCase => ({
  format,
  name: `${format}-${op}`,
  input: '1',
  patch: [{ op, path: '' }],
  expected: '1',
  tags: { op },
});
const cases = [make('json', 'add'), make('jsonc', 'add'), make('jsonc', 'remove')];
const names = (selected: GoldenCase[]) => selected.map((c) => c.name);

describe('selectGoldenCases', () => {
  it('returns every case without a filter', () => {
    expect(selectGoldenCases(cases, {})).toEqual(cases);
  });

  it('keeps cases matching both the format and the op lists', () => {
    expect(names(selectGoldenCases(cases, { formats: ['jsonc'] }))).toEqual([
      'jsonc-add',
      'jsonc-remove',
    ]);
    expect(names(selectGoldenCases(cases, { formats: ['json', 'jsonc'], ops: ['add'] }))).toEqual([
      'json-add',
      'jsonc-add',
    ]);
  });

  it('fails when a named format, op or pair has no case', () => {
    expect(() => selectGoldenCases(cases, { formats: ['json5'] })).toThrow(
      'golden filter selects no case for format json5 × op any',
    );
    expect(() => selectGoldenCases(cases, { ops: ['move'] })).toThrow(
      'golden filter selects no case for format any × op move',
    );
    expect(() => selectGoldenCases(cases, { formats: ['json', 'jsonc'], ops: ['remove'] })).toThrow(
      'golden filter selects no case for format json × op remove',
    );
  });

  it('reads GOLDEN_FORMAT and GOLDEN_OP', () => {
    expect(filterFromEnv({ GOLDEN_FORMAT: 'json,jsonc', GOLDEN_OP: 'add' })).toEqual({
      formats: ['json', 'jsonc'],
      ops: ['add'],
    });
    expect(filterFromEnv({})).toEqual({ formats: undefined, ops: undefined });
  });
});

describe('pnpm test:golden flags', () => {
  const script = path.join(import.meta.dirname, '../../scripts/test-golden.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it.each([
    [['--coverage'], 'unknown argument --coverage'],
    [['--', '--coverage-only', '--watch'], 'unknown argument --watch'],
    [['--format', 'yaml'], 'unknown --format value yaml'],
    [['--op=ad,add'], 'unknown --op value ad'],
    [['--format'], '--format needs a value'],
    [['--op', 'add', '--op', 'remove'], '--op given twice'],
    [['--coverage-only', '--format', 'json'], '--coverage-only checks the whole corpus'],
  ])('rejects %j before running any test', (args, message) => {
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  });
});
