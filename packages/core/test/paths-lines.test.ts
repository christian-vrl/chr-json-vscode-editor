// JSON Lines items as the text counts them (A5) and as the CHR JSON Editor's table and tree do
// (spec 012 L1: bad lines left out), 018 T4 and UNK-090.
import { describe, expect, it } from 'vitest';
import { badItems, readLines, tablePath, textPath } from '../src/index.js';

describe('JSON Lines items past bad lines', () => {
  it('maps JSON Lines items between the text and the table, which leaves bad lines out (018 T4)', () => {
    // Items (A5): 0 Ada, 1 bad, 2 Grace, (blank lines), 3 bad, 4 Linus.
    const text = '{"n":"Ada"}\n{bad\n{"n":"Grace"}\r\n\n  \n{x}\n{"n":"Linus"}\n';
    const bad = badItems(text);
    expect(bad).toEqual([1, 3]);
    expect(tablePath([0, 'n'], bad)).toEqual([0, 'n']);
    expect(tablePath([2, 'n'], bad)).toEqual([1, 'n']);
    expect(tablePath([4], bad)).toEqual([2]);
    expect(textPath([0, 'n'], bad)).toEqual([0, 'n']);
    expect(textPath([1, 'n'], bad)).toEqual([2, 'n']);
    expect(textPath([2], bad)).toEqual([4]);
    expect(tablePath([], bad)).toEqual([]);
    expect(textPath([], bad)).toEqual([]);
    expect(badItems('{"a":1}\n\n{"b":2}\n')).toEqual([]);
    expect(badItems('\ufeff{x}\n{"a":1}\n')).toEqual([0]);
  });

  it('counts a line ending in a lone CR as A5 and readLines do: not blank, and bad', () => {
    const text = '{"a":1}\n  \r\n{"b":2}\n  \r';
    expect(readLines(text).bad).toEqual([4]);
    expect(badItems(text)).toEqual([2]);
    expect(badItems('{x}\n  \r\n{"a":1}\n')).toEqual([0]);
  });
});
