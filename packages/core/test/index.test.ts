import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index.js';

describe('core', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@chr-json-editor/core');
  });
});
