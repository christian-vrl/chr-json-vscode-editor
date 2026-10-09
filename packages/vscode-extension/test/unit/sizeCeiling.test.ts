// Unit checks for the ceiling message of "Open in CHR JSON Editor" (spec 008 criterion 9). The e2e
// suite (test/e2e/ceiling.cjs) runs the command on files just below and above the limit.
import { describe, expect, it } from 'vitest';
import { ceilingMessage, mib, SYNC_LIMIT } from '../../src/sizeCeiling';

describe('SYNC_LIMIT', () => {
  it('is 50 × 2^20 bytes', () => {
    expect(SYNC_LIMIT).toBe(52_428_800);
  });
});

describe('mib', () => {
  it.each([
    [0, '0.0'],
    [SYNC_LIMIT, '50.0'],
    [SYNC_LIMIT + 1, '50.0'],
    [SYNC_LIMIT + 104_857, '50.0'],
    [SYNC_LIMIT + 104_858, '50.1'],
    [Math.floor(62.99 * 1024 * 1024), '62.9'],
    [100 * 1024 * 1024, '100.0'],
  ])('%i bytes is %s MiB, rounded down', (bytes, text) => {
    expect(mib(bytes)).toBe(text);
  });
});

describe('ceilingMessage', () => {
  it('names the file and its size', () => {
    expect(ceilingMessage('big.json', 60 * 1024 * 1024)).toBe(
      "big.json is 60.0 MiB. VS Code does not pass files above 50 MB to extensions, so CHR JSON Editor can't open it.",
    );
  });
});
