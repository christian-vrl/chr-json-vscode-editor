// Unit checks for 003 T10's format badge (criterion 8) against the real core: what is detected, what
// a re-parse as another format finds, and what the status-bar item says. The e2e suite checks the
// same in VS Code, plus that choosing a format leaves the document's bytes unchanged.
import { describe, expect, it } from 'vitest';
import { detect, getAdapter, parseData } from '@chr-json-editor/core';
import { badge, initialState, reparse, withFormat, type FormatCore } from '../../src/formatBadge';

const core: FormatCore = { detect, getAdapter, parseData };
const JSONC = '{\n  // a comment\n  "a": 1,\n}\n';

describe('initialState', () => {
  it('detects per R11 and parses as the detected format', () => {
    expect(initialState(core, '/w/a.json', 'json', '{"a": 1}')).toEqual({
      format: 'json',
      detected: 'json',
      source: 'languageId',
      outcome: { kind: 'parsed', errors: 0, warnings: 0 },
    });
    // UNK-019 (names first): a VS Code JSONC file name beats the .json extension.
    expect(initialState(core, '/w/tsconfig.json', 'plaintext', JSONC)).toMatchObject({
      format: 'jsonc',
      source: 'fileName',
      outcome: { kind: 'parsed', errors: 0, warnings: 0 },
    });
  });

  it('json5 parses with the JSON5 adapter (002 T5)', () => {
    const state = initialState(core, '/w/a.json5', 'plaintext', "{a: 'b'}");
    expect(state).toMatchObject({
      format: 'json5',
      source: 'extension',
      outcome: { kind: 'parsed', errors: 0 },
    });
    expect(badge(state).text).toBe('JSON5');
  });
});

describe('reparse', () => {
  it('counts strict-JSON violations as warnings when parsed as json', () => {
    expect(reparse(core, JSONC, 'json')).toEqual({ kind: 'parsed', errors: 0, warnings: 2 });
    expect(reparse(core, JSONC, 'jsonc')).toEqual({ kind: 'parsed', errors: 0, warnings: 0 });
  });

  it('counts syntax errors', () => {
    expect(reparse(core, '{"a": }', 'jsonc')).toMatchObject({ kind: 'parsed', errors: 1 });
  });
});

describe('badge', () => {
  it('names the format, how it was picked, and what the parse found', () => {
    const detected = initialState(core, '/w/a.jsonc', 'jsonc', JSONC);
    expect(badge(detected)).toEqual({
      text: 'JSONC',
      tooltip: 'JSONC: Detected from the language mode. Click to parse it as another format.',
    });
    const asJson = withFormat(core, detected, JSONC, 'json');
    expect(asJson).toMatchObject({ format: 'json', detected: 'jsonc' });
    expect(badge(asJson)).toEqual({
      text: '$(warning) JSON',
      tooltip:
        'JSON: Chosen by you; detected as JSONC. 2 warnings as JSON. Click to parse it as another format.',
    });
    const broken = withFormat(core, detected, '{"a": }', 'jsonc');
    expect(badge(broken).text).toBe('$(error) JSONC');
    expect(badge(broken).tooltip).toContain('1 parse error as JSONC.');
  });
});
