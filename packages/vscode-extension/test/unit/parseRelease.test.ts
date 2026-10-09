// Unit checks for when the host drops core's cached parses (003 T11 follow-up, UNK-014).
import { describe, expect, it } from 'vitest';
import { parseToRelease, type ClosedDocument } from '../../src/parseRelease';

/** A closed document that counts how often its text was read. */
function closed(path: string, languageId: string, text = '{}') {
  const document = {
    languageId,
    uri: { path },
    reads: 0,
    getText() {
      document.reads++;
      return text;
    },
  } satisfies ClosedDocument & { reads: number };
  return document;
}

describe('parseToRelease', () => {
  it('drops every parse once no editor is open, without reading the text', () => {
    for (const document of [closed('/w/a.json', 'json'), closed('/w/big.log', 'log')]) {
      expect(parseToRelease(document, 0)).toBe('all');
      expect(document.reads).toBe(0);
    }
  });

  it('drops the parse of a closed JSON document while editors stay open', () => {
    expect(parseToRelease(closed('/w/a.json', 'json', '{"a":1}'), 1)).toEqual({ text: '{"a":1}' });
    expect(parseToRelease(closed('/w/a.jsonc', 'plaintext'), 2)).toEqual({ text: '{}' });
    expect(parseToRelease(closed('/w/A.JSON5', 'plaintext'), 1)).toEqual({ text: '{}' });
    expect(parseToRelease(closed('/w/.eslintrc', 'jsonc'), 1)).toEqual({ text: '{}' });
    expect(parseToRelease(closed('/w/a.txt', 'json5'), 1)).toEqual({ text: '{}' });
  });

  it('skips a document of another language without reading its text', () => {
    for (const document of [
      closed('/w/big.log', 'log'),
      closed('/w/a.ts', 'typescript'),
      closed('/w/a.json.bak', 'plaintext'),
    ]) {
      expect(parseToRelease(document, 1)).toBeUndefined();
      expect(document.reads).toBe(0);
    }
  });
});
