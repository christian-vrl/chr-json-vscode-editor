import { describe, expect, it } from 'vitest';
import { tagMismatches } from './facts.js';
import type { GoldenCase } from './load.js';

const tags = {
  op: 'replace',
  location: 'root',
  comments: 'none',
  trailingComma: 'no',
  quote: 'single',
  keyStyle: 'unquoted',
  special: 'none',
};
const make = (
  input: string,
  patch: GoldenCase['patch'],
  extra: Record<string, string> = {},
): GoldenCase => ({
  format: 'json5',
  name: 'x',
  input,
  patch,
  expected: input,
  tags: { ...tags, ...extra },
});

describe('tagMismatches', () => {
  it('accepts tags that describe the case', () => {
    expect(
      tagMismatches(make("{a: 'x', b: 'y'}", [{ op: 'replace', path: '/a', value: 1 }])),
    ).toEqual([]);
  });

  it('reports each tag the input or patch contradicts', () => {
    const c = make('{"a": [1, 0x2, 3,], /* c */ "b": "y"}', [{ op: 'remove', path: '/a/1' }]);
    expect(tagMismatches(c)).toEqual([
      'op: patch has no "replace" operation',
      'comments: input has 1 comment(s)',
      'trailingComma: input says yes',
      'quote: most strings use "',
      'keyStyle: most keys are quoted',
      'special: input has hex',
    ]);
  });

  it('derives location from the path, after the ops before it', () => {
    const patch = [
      { op: 'remove', path: '/a/2' },
      { op: 'replace', path: '/a/1', value: 0 },
    ];
    expect(
      tagMismatches(make("{a: ['p', 'q', 'r']}", patch, { location: 'array-middle' })),
    ).toEqual(['location: path points at array-end']);
    expect(
      tagMismatches(make("{o: {k: 'v'}}", [{ op: 'add', path: '/o/n', value: 1 }], { op: 'add' })),
    ).toEqual(['location: path points at nested-object']);
  });
});
