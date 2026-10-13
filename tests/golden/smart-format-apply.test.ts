// Criterion 1 of spec 010 (010 T2): for every smart-format case, `smartFormat(input, format)` is
// byte-equal to expected, and smart-formatting expected changes nothing (criterion 4).
import { smartFormat } from '../../packages/core/src/index.js';
import { describe, expect, it } from 'vitest';
import { loadSmartFormatCases } from './smart-format.js';

describe.each(loadSmartFormatCases().map((c) => [`${c.format}/${c.name}`, c] as const))(
  'smart-format %s',
  (_, c) => {
    it('gives the expected bytes (criterion 1)', () => {
      expect(JSON.stringify(smartFormat(c.input, c.format))).toBe(JSON.stringify(c.expected));
    });

    it('leaves expected as it is (criterion 4)', () => {
      expect(JSON.stringify(smartFormat(c.expected, c.format))).toBe(JSON.stringify(c.expected));
    });
  },
);
