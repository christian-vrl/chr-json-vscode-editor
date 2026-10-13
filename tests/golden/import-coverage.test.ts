// Spec 017 criterion 2 (017 T1): `pnpm test:golden -- --coverage-only` runs this file with the other
// coverage tests.
import { describe, expect, it } from 'vitest';
import {
  importMissingCells,
  importPerKind,
  importRules,
  importTagErrors,
  importTags,
  loadImportCases,
  type ImportCase,
} from './import.js';

describe('import corpus coverage (spec 017 criterion 2)', () => {
  const cases = loadImportCases();

  it('tags every case with known rules and tags of its kind', () => {
    const errors = cases.flatMap((c) =>
      importTagErrors(c).map((error) => `${c.kind}/${c.name}: ${error}`),
    );
    expect(errors).toEqual([]);
  });

  it('covers every rule A1–A6, Y1–Y8, TM1–TM5, XM1–XM8 and every tag of criterion 2', () => {
    expect(importMissingCells(cases)).toEqual([]);
  });
});

describe('import coverage helpers', () => {
  const yaml = (tags: object) => ({ kind: 'yaml', tags }) as Pick<ImportCase, 'kind' | 'tags'>;

  it('know the vocabulary', () => {
    expect(importRules.all).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(importRules.yaml).toEqual(['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8']);
    expect(importRules.toml).toEqual(['TM1', 'TM2', 'TM3', 'TM4', 'TM5']);
    expect(importRules.xml).toEqual(['XM1', 'XM2', 'XM3', 'XM4', 'XM5', 'XM6', 'XM7', 'XM8']);
    expect([
      ...importTags.all,
      ...importTags.yaml,
      ...importTags.toml,
      ...importTags.xml,
    ]).toHaveLength(31);
    expect(importPerKind).toEqual({
      'too-deep': ['yaml', 'toml', 'xml'],
      malformed: ['yaml', 'toml', 'xml'],
      'big-decimal': ['yaml', 'xml'],
    });
  });

  it('reject missing, unknown, repeated and other-kind tags', () => {
    expect(importTagErrors(yaml({ rules: ['A1', 'Y2'], tags: [] }))).toEqual([]);
    expect(
      importTagErrors(yaml({ rules: ['A1', 'TM1', 'A1'], tags: ['xml-cdata', 'bom'], note: 1 })),
    ).toEqual([
      'unknown tag "note"',
      'tag "rules" has value "TM1", unknown for yaml',
      'tag "rules" repeats a value',
      'tag "tags" has value "xml-cdata", unknown for yaml',
    ]);
    expect(importTagErrors(yaml({ rules: [] }))).toEqual([
      'tag "rules" must be a non-empty list',
      'missing tag "tags"',
    ]);
  });

  it('list the cells no case covers, per kind where criterion 2 asks', () => {
    const missing = importMissingCells([]);
    expect(missing).toHaveLength(6 + 8 + 5 + 8 + 31 - 3 + 3 + 3 + 2);
    expect(missing).toContain('too-deep (toml)');
    expect(missing).toContain('big-decimal (xml)');
    expect(missing).not.toContain('big-decimal (toml)');
    const some = importMissingCells([
      { kind: 'yaml', tags: { rules: ['A5', 'Y8'], tags: ['too-deep', 'big-decimal', 'bom'] } },
    ]);
    expect(some).not.toContain('A5');
    expect(some).not.toContain('Y8');
    expect(some).not.toContain('bom');
    expect(some).not.toContain('too-deep (yaml)');
    expect(some).toContain('too-deep (xml)');
    expect(some).not.toContain('big-decimal (yaml)');
    expect(some).toContain('big-decimal (xml)');
  });
});
