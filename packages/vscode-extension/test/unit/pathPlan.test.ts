// pathPlan (018 T3): what the copy path and reveal commands read and say, without VS Code (spec 018
// S5, S6). The e2e suite (test/e2e/copyPath.cjs) runs the same through the commands.
import { describe, expect, it } from 'vitest';
import {
  brokenMessage,
  copiedMessage,
  nodeAtCursor,
  nodeOutcome,
  notInDocumentMessage,
  pathText,
  SEVERAL_NODES_MESSAGE,
} from '../../src/pathPlan';

describe('pathPlan', () => {
  it('writes the path as JSONPath (P1) or JSON Pointer (P2)', () => {
    expect(pathText('jsonPath', ['people', 1, 'a.b'])).toBe("$.people[1]['a.b']");
    expect(pathText('jsonPointer', ['people', 1, 'a.b'])).toBe('/people/1/a.b');
    expect(pathText('jsonPath', [])).toBe('$');
    expect(pathText('jsonPointer', [])).toBe('');
    expect(pathText('jsonPointer', ['a/b', 'm~n'])).toBe('/a~1b/m~0n');
  });

  it('says what was copied, the root pointer in words (S5)', () => {
    expect(copiedMessage('jsonPath', '$.count')).toBe('Copied $.count');
    expect(copiedMessage('jsonPath', '$')).toBe('Copied $');
    expect(copiedMessage('jsonPointer', '/count')).toBe('Copied /count');
    expect(copiedMessage('jsonPointer', '')).toBe(
      'Copied the empty JSON Pointer (the whole document)',
    );
  });

  it('reads the node at the cursor, clamping the offset to the text', () => {
    const text = '{ "people": [{ "name": "Ada" }], "count": 1 }';
    expect(nodeAtCursor('json', text, text.indexOf('"Ada"'))).toEqual({
      kind: 'path',
      path: ['people', 0, 'name'],
    });
    expect(nodeAtCursor('json', text, text.length + 5)).toEqual({ kind: 'path', path: [] });
    expect(nodeAtCursor('json', text, -1)).toEqual({ kind: 'path', path: [] });
  });

  it('gives S6 for a text that stops reading before the cursor (A6)', () => {
    const text = '{\n  ok: 1,\n  bad: [1 2],\n  after: true,\n}\n';
    const node = nodeAtCursor('json5', text, text.indexOf('after'));
    expect(node).toMatchObject({ kind: 'error', line: 3, column: 11 });
    expect(nodeOutcome('json5', node)).toEqual({
      severity: 'error',
      message:
        "CHR JSON Editor: can't find the node: the document is not valid JSON5 " +
        '(error at line 3, column 11). Fix it or run "Repair JSON" first.',
    });
  });

  it('names the repair command of the format', () => {
    expect(brokenMessage('json', 1, 2)).toMatch(/not valid JSON \(error at line 1, column 2\)/);
    expect(brokenMessage('jsonc', 1, 2)).toMatch(/run "Repair JSON" first\.$/);
    expect(brokenMessage('jsonl', 4, 1)).toMatch(/not valid JSON Lines .* run "Repair Lines"/);
  });

  it('goes on with a path, and stops with S1 for several nodes', () => {
    expect(nodeOutcome('json', { kind: 'path', path: ['a'] })).toEqual({ path: ['a'] });
    expect(nodeOutcome('json', { kind: 'several' })).toEqual({
      severity: 'info',
      message: SEVERAL_NODES_MESSAGE,
    });
    expect(SEVERAL_NODES_MESSAGE).toBe('Select one node to copy its path.');
  });

  it('names a path with no place by its JSONPath (S6)', () => {
    expect(notInDocumentMessage(['count'])).toBe(
      "CHR JSON Editor: can't find the node: $.count is not in the document.",
    );
  });
});
