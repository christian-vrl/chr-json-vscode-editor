// Spec 009 criterion 2 (009 T1): `pnpm test:golden -- --coverage-only` runs this file with
// coverage.test.ts and convert-coverage.test.ts.
import { describe, expect, it } from 'vitest';
import {
  csvDelimiters,
  csvDirections,
  csvMissingCells,
  csvRules,
  csvTagErrors,
  loadCsvCases,
  type CsvCase,
} from './csv.js';

describe('CSV corpus coverage (spec 009 criterion 2)', () => {
  const cases = loadCsvCases();

  it('tags every case with known rules of its direction and known values and features', () => {
    const errors = cases.flatMap((c) =>
      csvTagErrors(c).map((error) => `${c.direction}/${c.name}: ${error}`),
    );
    expect(errors).toEqual([]);
  });

  it.each(csvDirections)('covers every criterion 2 cell for %s', (direction) => {
    expect(csvMissingCells(cases, direction)).toEqual([]);
  });
});

describe('CSV coverage helpers', () => {
  const exportCase = (tags: object, options: object = {}) =>
    ({ direction: 'export', name: 'a', input: [], options, tags }) as CsvCase;

  it('know the rules and delimiters of each direction', () => {
    expect(csvRules.export).toEqual(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7']);
    expect(csvRules.import).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']);
    expect(csvDelimiters.export).toEqual([',', ';', '\t', '|']);
    expect(csvDelimiters.import).toEqual([',', ';', '\t', '|', 'detect']);
  });

  it('reject missing, unknown, repeated and other-direction tags', () => {
    expect(csvTagErrors(exportCase({ rules: ['X1'], values: ['number'] }))).toEqual([]);
    expect(
      csvTagErrors(exportCase({ rules: ['X1', 'I1', 'X1'], values: [], feature: ['x'] })),
    ).toEqual([
      'unknown tag "feature"',
      'tag "rules" has unknown value "I1"',
      'tag "rules" repeats a value',
      'tag "values" must be a non-empty list',
    ]);
    expect(csvTagErrors(exportCase({ features: ['one-column'] }))).toEqual([
      'missing tag "rules"',
      'tag "features" has unknown value "one-column"',
    ]);
  });

  it('list the cells no case covers', () => {
    expect(csvMissingCells([], 'export')).toEqual([
      'X1',
      'X2',
      'X3',
      'X4',
      'X5',
      'X6',
      'X7',
      'value=number',
      'value=true',
      'value=false',
      'value=null',
      'value=empty',
      'value=json',
      'value=text',
      'one-column-null-row',
      'delimiter=","',
      'delimiter=";"',
      'delimiter="\\t"',
      'delimiter="|"',
      'header=off',
    ]);
    expect(csvMissingCells([], 'import')).toHaveLength(7 + 7 + 1 + 5 + 1);
    // An export case with no options covers the default ","; header off comes from options.json.
    const covered = csvMissingCells(
      [
        exportCase({ rules: ['X1'], values: ['json'] }),
        exportCase({ rules: ['X7'], features: ['one-column-null-row'] }, { header: false }),
      ],
      'export',
    );
    expect(covered).not.toContain('X1');
    expect(covered).not.toContain('value=json');
    expect(covered).not.toContain('one-column-null-row');
    expect(covered).not.toContain('delimiter=","');
    expect(covered).not.toContain('header=off');
    expect(covered).toContain('delimiter=";"');
    // An import case with no delimiter option covers "detect", not ",".
    const detect = csvMissingCells(
      [{ direction: 'import', name: 'b', input: '', options: {}, tags: { rules: ['I3'] } }],
      'import',
    );
    expect(detect).not.toContain('delimiter="detect"');
    expect(detect).toContain('delimiter=","');
  });
});
