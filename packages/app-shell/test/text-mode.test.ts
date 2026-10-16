// Text mode's cursor through a change made outside the editor (003 T7 F2): mapOffset reads the
// change as one span and keeps an offset outside it with its text.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mapOffset } from '../src/text-mode.js';

describe('mapOffset', () => {
  const typed = '{\n  "a": 1xyz,\n  "b": 2\n}\n';
  const plain = '{\n  "a": 1,\n  "b": 2\n}\n';
  const afterOne = plain.indexOf('1') + 1;

  it('puts the cursor where undone typing started', () => {
    expect(mapOffset(typed, plain, afterOne + 3)).toBe(afterOne);
  });

  it('puts the cursor after redone typing', () => {
    expect(mapOffset(plain, typed, afterOne)).toBe(afterOne + 3);
  });

  it('keeps an offset before the change and moves one after it with its text', () => {
    expect(mapOffset(typed, plain, 3)).toBe(3);
    const b = typed.indexOf('"b"');
    expect(mapOffset(typed, plain, b)).toBe(plain.indexOf('"b"'));
  });

  it('keeps every offset of an unchanged text', () => {
    for (let at = 0; at <= plain.length; at++) expect(mapOffset(plain, plain, at)).toBe(at);
  });

  it('reads a change in a run of equal characters as one span', () => {
    // fast-check seed 571599554 (CI run 38900064515): "xx" → "x" reads as the second x removed.
    expect(mapOffset('xx', 'x', 1)).toBe(1);
    expect(mapOffset('xx', 'x', 2)).toBe(1);
  });

  it('never leaves the new text', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (before, after) => {
        for (let at = 0; at <= before.length; at++) {
          const to = mapOffset(before, after, at);
          expect(to).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThanOrEqual(after.length);
        }
      }),
    );
  });

  it('keeps an offset outside an unambiguous change with its text, and puts one inside at its end', () => {
    // The removed text, the added text and the text around them share no character, so the span
    // read as changed is exactly theirs.
    const around = fc.string({ unit: fc.constantFrom('a', 'b', '\n') });
    const removed = fc.string({ unit: fc.constantFrom('x', 'X') });
    const inserted = fc.string({ unit: fc.constantFrom('y', 'Y') });
    fc.assert(
      fc.property(around, removed, inserted, around, (head, gone, added, tail) => {
        fc.pre(gone !== added);
        const before = head + gone + tail;
        const after = head + added + tail;
        for (let at = 0; at <= before.length; at++) {
          const expected =
            at < head.length
              ? at
              : at > head.length + gone.length
                ? at - gone.length + added.length
                : head.length + added.length;
          expect(mapOffset(before, after, at)).toBe(expected);
        }
      }),
    );
  });
});
