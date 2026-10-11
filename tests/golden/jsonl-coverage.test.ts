// Spec 012 criterion 2 (012 T1): `pnpm test:golden -- --coverage-only` runs this file with the other
// coverage tests.
import { describe, expect, it } from 'vitest';
import {
  jsonlFacts,
  jsonlLocations,
  jsonlMissingCells,
  jsonlOps,
  jsonlRules,
  jsonlTagErrors,
  loadJsonlCases,
} from './jsonl.js';

describe('JSON Lines corpus coverage (spec 012 criterion 2)', () => {
  const cases = loadJsonlCases();

  it('tags every case with known rules, and every patch case with a known op and location', () => {
    const errors = cases.flatMap((c) => jsonlTagErrors(c).map((error) => `${c.name}: ${error}`));
    expect(errors).toEqual([]);
  });

  it('covers every rule, op × location, line ending, final newline, blank-line place, BOM and empty text', () => {
    expect(jsonlMissingCells(cases)).toEqual([]);
  });
});

describe('JSON Lines coverage helpers', () => {
  it('know the vocabulary', () => {
    expect(jsonlRules).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10']);
    expect(jsonlOps).toEqual(['add', 'replace', 'remove', 'move', 'copy', 'test', 'test-fail']);
    expect(jsonlLocations).toEqual(['item', 'nested', 'root']);
  });

  it('accept well-formed tags', () => {
    const tags = { rules: ['L3', 'L9'], op: 'add', location: 'item' };
    expect(jsonlTagErrors({ kind: 'patch', tags })).toEqual([]);
    expect(jsonlTagErrors({ kind: 'parse', tags: { rules: ['L1'] } })).toEqual([]);
    expect(jsonlTagErrors({ kind: 'repair', tags: { rules: ['L10'] } })).toEqual([]);
  });

  it('reject missing, unknown and misplaced tags', () => {
    const tags = { rules: ['L3', 'L11', 'L3'], op: 'append', locaton: 'item' } as never;
    expect(jsonlTagErrors({ kind: 'patch', tags })).toEqual([
      'unknown tag "locaton" for a patch case',
      'tag "rules" has unknown value "L11"',
      'tag "rules" repeats a rule',
      'tag "op" has unknown value "append"',
      'missing tag "location"',
    ]);
    expect(jsonlTagErrors({ kind: 'parse', tags: { rules: ['L2'], op: 'add' } })).toEqual([
      'unknown tag "op" for a parse case',
      'a parse case must tag L1',
    ]);
    expect(jsonlTagErrors({ kind: 'repair', tags: { rules: [] } })).toEqual([
      'tag "rules" must be a non-empty list',
    ]);
    expect(jsonlTagErrors({ kind: 'repair', tags: { rules: ['L1'] } })).toEqual([
      'a repair case must tag L10',
    ]);
  });

  it('read the text facts from the input', () => {
    expect(jsonlFacts('﻿\n1\r\n \n2\n\t')).toEqual({
      eol: 'lf',
      finalNewline: false,
      blank: ['before', 'between', 'after'],
      bom: true,
      empty: false,
    });
    expect(jsonlFacts('1\r\n')).toEqual({
      eol: 'crlf',
      finalNewline: true,
      blank: [],
      bom: false,
      empty: false,
    });
    expect(jsonlFacts('')).toEqual({
      eol: 'none',
      finalNewline: false,
      blank: [],
      bom: false,
      empty: true,
    });
    // A blank line with nothing else is before, between or after no item.
    expect(jsonlFacts('\n').blank).toEqual([]);
  });

  it('list the cells no case covers', () => {
    expect(jsonlMissingCells([])).toHaveLength(10 + 7 * 2 + 9);
    const one = { kind: 'patch' as const, tags: { rules: ['L3'], op: 'add', location: 'item' } };
    const missing = jsonlMissingCells([{ ...one, input: '1\n\n2' }]);
    expect(missing).not.toContain('rule L3');
    expect(missing).not.toContain('op add × location item');
    expect(missing).toContain('op add × location nested');
    expect(missing).not.toContain('line ending LF');
    expect(missing).not.toContain('no final newline');
    expect(missing).not.toContain('blank lines between items');
    expect(missing).toContain('blank lines before items');
    expect(missing).toContain('empty text');
  });
});
