// Smart Format's guard and messages (010 T3, spec 010 criteria 8–10), shared by the webview's
// action and the command.
import { describe, expect, it } from 'vitest';
import { LARGE_FILE_THRESHOLD } from '../../src/largeFile';
import { brokenMessage, plan, TOO_LARGE_MESSAGE, tooLarge } from '../../src/smartFormatPlan';

describe('Smart Format plan', () => {
  it('lays the text out with core smartFormat', () => {
    expect(plan('[\n  1,\n  2\n]\n', 'json')).toEqual({ kind: 'formatted', text: '[1, 2]\n' });
  });

  it('makes no edit on an already smart-formatted text or one with no value (criterion 8)', () => {
    expect(plan('[1, 2]\n', 'json')).toEqual({ kind: 'same' });
    expect(plan('// only a comment\n', 'jsonc')).toEqual({ kind: 'same' });
  });

  it("refuses a text that does not parse with criterion 9's message", () => {
    for (const [format, label] of [
      ['json', 'JSON'],
      ['jsonc', 'JSONC'],
      ['json5', 'JSON5'],
    ] as const) {
      const message = `Smart Format needs valid ${label}. Fix the errors or run Repair JSON first.`;
      expect(brokenMessage(format)).toBe(message);
      expect(plan('{"a": ', format)).toEqual({ kind: 'refused', reason: 'broken', message });
    }
  });

  it('refuses a text above 5 MiB of UTF-8 and runs at exactly 5 MiB (criterion 10)', () => {
    expect(TOO_LARGE_MESSAGE).toBe(
      'Smart Format is off for documents above 5 MiB because it can take a long time. Use Format instead.',
    );
    const at = `"${'a'.repeat(LARGE_FILE_THRESHOLD - 2)}"`;
    expect(tooLarge(at)).toBe(false);
    expect(plan(at, 'json')).toEqual({ kind: 'same' });
    const over = `"${'a'.repeat(LARGE_FILE_THRESHOLD - 1)}"`;
    expect(plan(over, 'json')).toEqual({
      kind: 'refused',
      reason: 'too-large',
      message: TOO_LARGE_MESSAGE,
    });
  });

  it('counts UTF-8 bytes, not UTF-16 units: a text under 5 Mi units can be above 5 MiB', () => {
    // 'é' is two bytes in UTF-8: about 2.5 Mi units, 5 MiB + 2 bytes.
    const text = `"${'é'.repeat(LARGE_FILE_THRESHOLD / 2)}"`;
    expect(text.length).toBeLessThan(LARGE_FILE_THRESHOLD);
    expect(tooLarge(text)).toBe(true);
  });
});
