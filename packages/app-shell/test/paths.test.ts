// The page's side of copy path (spec 018 S1, S3; 018 T2): what a library selection names, the
// library's string paths as core's paths read against its data or its text, and the navigation
// bar's edit box reading JSONPath and JSON Pointer.
import { describe, expect, it } from 'vitest';
import {
  hasNode,
  NOT_IN_DOCUMENT,
  PathTextError,
  readNavigationPath,
  selectedPath,
  stepsOf,
  type PathView,
} from '../src/paths.js';

const DATA = { list: ['x', { '0': 'y' }], map: { '0': 'z', 'a.b': [1] } };
const TEXT = `{
  // a comment
  "list": ["x", {"0": "y"}],
  map: {'0': 'z', "a.b": [1],},
}`;
const views: [string, PathView][] = [
  ['data', { json: DATA }],
  ['json5 text', { text: TEXT, format: 'json5' }],
];

describe('S1: the selection names one node', () => {
  it('a key, a value, an inside or after caret, and one node of a multi-selection', () => {
    expect(selectedPath({ type: 'key', path: ['a'] })).toEqual(['a']);
    expect(selectedPath({ type: 'value', path: ['a', '0'] })).toEqual(['a', '0']);
    expect(selectedPath({ type: 'inside', path: ['a'] })).toEqual(['a']);
    expect(selectedPath({ type: 'after', path: ['a', '1'] })).toEqual(['a', '1']);
    expect(selectedPath({ type: 'multi', anchorPath: ['b'], focusPath: ['b'] })).toEqual(['b']);
  });

  it('several nodes name none, no selection the root, a text selection an offset', () => {
    expect(selectedPath({ type: 'multi', anchorPath: ['a'], focusPath: ['b'] })).toBe('several');
    expect(selectedPath(undefined)).toEqual([]);
    expect(selectedPath({ type: 'text' })).toBeUndefined();
  });
});

describe.each(views)('library paths against the %s', (_name, view) => {
  it('steps into arrays are indices, into objects names', () => {
    expect(stepsOf(view, ['list', '1', '0'])).toEqual(['list', 1, '0']);
    expect(stepsOf(view, ['map', '0'])).toEqual(['map', '0']);
    expect(stepsOf(view, ['map', 'a.b', '0'])).toEqual(['map', 'a.b', 0]);
    expect(stepsOf(view, [])).toEqual([]);
  });

  it('a step past what is shown stays a name', () => {
    expect(stepsOf(view, ['missing', '0'])).toEqual(['missing', '0']);
  });

  it('knows which nodes are there', () => {
    expect(hasNode(view, ['list', 1, '0'])).toBe(true);
    expect(hasNode(view, ['list', '1'])).toBe(false);
    expect(hasNode(view, ['map', 0])).toBe(false);
    expect(hasNode(view, ['list', 2])).toBe(false);
  });

  it('S3 reads a JSONPath or a JSON Pointer to a node that is there', () => {
    expect(readNavigationPath(view, "$.map['0']")).toEqual(['map', '0']);
    expect(readNavigationPath(view, '$.list[1]')).toEqual(['list', '1']);
    expect(readNavigationPath(view, '/list/1/0')).toEqual(['list', '1', '0']);
    expect(readNavigationPath(view, '  $  ')).toEqual([]);
    expect(readNavigationPath(view, '')).toEqual([]);
  });

  it('S3 refuses what P3 refuses, and a path to no node', () => {
    const refusal = (text: string) => {
      try {
        readNavigationPath(view, text);
      } catch (error) {
        expect(error).toBeInstanceOf(PathTextError);
        return String(error);
      }
      throw new Error(`${text} was read`);
    };
    expect(refusal('$..name')).toBe(
      'Not a path to one node: `..` selects descendants, not one node.',
    );
    expect(refusal('$.list[*]')).toMatch(/^Not a path to one node: /);
    expect(refusal('list')).toMatch(/^Not a path to one node: /);
    // `[0]` is an index (P3); the object `map` has the name "0", not an index.
    expect(refusal('$.map[0]')).toBe(NOT_IN_DOCUMENT);
    expect(refusal("$.list['1']")).toBe(NOT_IN_DOCUMENT);
    expect(refusal('/nope')).toBe(NOT_IN_DOCUMENT);
  });
});
