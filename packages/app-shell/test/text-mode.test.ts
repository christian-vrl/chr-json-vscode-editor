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

  it('never leaves the new text, and keeps the text around the change', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), fc.string(), (head, gone, added, tail) => {
        const before = head + gone + tail;
        const after = head + added + tail;
        for (let at = 0; at <= before.length; at++) {
          const to = mapOffset(before, after, at);
          expect(to).toBeGreaterThanOrEqual(0);
          expect(to).toBeLessThanOrEqual(after.length);
          // The text before the cursor's new place is a start of the text before its old place,
          // or the other way round: it never lands inside text the cursor was not next to.
          if (at <= head.length)
            expect(after.slice(0, to).startsWith(before.slice(0, at))).toBe(true);
          if (at >= head.length + gone.length) {
            expect(after.slice(to)).toBe(before.slice(at));
          }
        }
      }),
    );
  });
});
