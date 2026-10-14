// 017 T3: the names and texts of the YAML, TOML and XML commands (spec 017 criteria 5–7).
import { LosslessNumber } from '@chr-json-editor/core';
import { describe, expect, it } from 'vitest';
import {
  errorMessage,
  jsonLinesMessage,
  jsonName,
  kindOf,
  replaceQuestion,
  warningLines,
  warningsMessage,
} from '../../src/importPlan';

describe('importPlan (spec 017 T3)', () => {
  it('takes the kind from the extension, in any case, never from the content', () => {
    expect(kindOf('/a/config.yaml')).toBe('yaml');
    expect(kindOf('/a/ci.YML')).toBe('yaml');
    expect(kindOf('/a/Cargo.toml')).toBe('toml');
    expect(kindOf('/a/pom.XML')).toBe('xml');
    for (const path of ['/a/data.json', '/a/yaml', '/a/.yaml', '/a/x.yaml.j2', '/a/x.plist'])
      expect(kindOf(path), path).toBeUndefined();
  });

  it('names the new file after the source (criterion 5)', () => {
    expect(jsonName('/a/config.yaml')).toBe('config.json');
    expect(jsonName('/a/Cargo.toml')).toBe('Cargo.json');
    expect(jsonName('/a/my.app.xml')).toBe('my.app.json');
    expect(jsonName('/a/.hidden')).toBe('.hidden.json');
  });

  it('gives the error with its line and column, or the line alone (criterion 7)', () => {
    expect(errorMessage('a.toml', { message: 'bad value', line: 3, column: 7 })).toBe(
      "CHR JSON Editor: can't convert a.toml: bad value (line 3, column 7).",
    );
    // A1, A5 and Y6 belong to the whole file and have no column (corpus README, reading 3).
    expect(errorMessage('a.xml', { message: 'Only UTF-8 files can be converted', line: 1 })).toBe(
      "CHR JSON Editor: can't convert a.xml: Only UTF-8 files can be converted (line 1).",
    );
  });

  it('counts warnings and lists each with its file and line (criterion 7)', () => {
    expect(warningsMessage('a.yaml', 2)).toBe('Converted a.yaml with 2 warnings.');
    expect(warningsMessage('a.yaml', 1)).toBe('Converted a.yaml with 1 warning.');
    expect(
      warningLines('a.yaml', [
        { message: 'Tag !Ref was ignored (1 place)', line: 2 },
        { message: 'x', line: 9 },
      ]),
    ).toEqual(['a.yaml:2: Tag !Ref was ignored (1 place)', 'a.yaml:9: x']);
  });

  it('asks before replacing the data (criterion 6)', () => {
    expect(replaceQuestion('doc.jsonc', 'data.yaml')).toBe(
      'Replace the data of doc.jsonc with the data of data.yaml? ' +
        'Comments on members that stay are kept.',
    );
  });

  it('names what a JSON Lines tab cannot take (criterion 6)', () => {
    const cases: [unknown, string][] = [
      [{}, 'an object'],
      ['x', 'a string'],
      [1, 'a number'],
      [new LosslessNumber('12345678901234567890'), 'a number'],
      [true, 'a boolean'],
      [null, 'null'],
    ];
    for (const [data, type] of cases)
      expect(jsonLinesMessage('a.toml', data)).toBe(
        `CHR JSON Editor: JSON Lines needs an array; a.toml holds ${type}.`,
      );
  });
});
