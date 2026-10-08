import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateLicense, readAllowlist } from '../../scripts/licenses/spdx.mjs';

const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
const allowed = readAllowlist(agents);

describe('readAllowlist', () => {
  it('reads AGENTS.md rule 4, the single source of the allowlist', () => {
    expect(allowed).toEqual([
      'MIT',
      'ISC',
      'BSD-2-Clause',
      'BSD-3-Clause',
      '0BSD',
      'Apache-2.0',
      'CC-BY-4.0',
    ]);
  });

  it('throws when the rule cannot be found', () => {
    expect(() => readAllowlist('# no rules here')).toThrow(/rule 4/);
  });
});

describe('evaluateLicense', () => {
  it.each([
    ['MIT'],
    ['Apache-2.0'],
    ['(CC-BY-4.0 AND MIT)'], // Font Awesome, spec 001 criterion 3
    ['MIT OR GPL-3.0'],
    ['GPL-3.0 OR MIT AND Apache-2.0'], // AND binds tighter than OR
    ['MIT AND GPL-3.0 OR ISC'],
    ['MIT AND (GPL-3.0 OR ISC)'],
    ['((MIT))'],
    ['mit or isc'], // ids match case-insensitively; lowercase operators are valid SPDX
    ['Apache-2.0 WITH LLVM-exception'], // an exception only adds permissions
  ])('allows %s', (expression) => {
    expect(evaluateLicense(expression, allowed)).toEqual({ allowed: true });
  });

  it.each([
    ['GPL-3.0', /GPL-3\.0/],
    ['MIT AND GPL-3.0', /GPL-3\.0/],
    ['(MIT AND GPL-3.0) OR LGPL-2.1', /GPL-3\.0.*LGPL-2\.1/],
    ['GPL-2.0 WITH Classpath-exception-2.0', /GPL-2\.0/],
    ['BlueOak-1.0.0', /BlueOak-1\.0\.0/], // minimatch: fine as a dev dependency, never shipped
    ['MIT+', /MIT\+/],
    ['LicenseRef-Proprietary', /LicenseRef-Proprietary/],
    ['UNLICENSED', /UNLICENSED/],
  ])('rejects %s', (expression, reason) => {
    const result = evaluateLicense(expression, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it.each([
    [undefined],
    [''],
    ['   '],
    ['MIT AND'],
    ['(MIT'],
    ['MIT)'],
    ['MIT ISC'],
    ['And MIT'],
    ['MIT WITH'],
    ['SEE LICENSE IN LICENSE.txt'],
  ])('rejects %j as not a valid SPDX expression', (expression) => {
    const result = evaluateLicense(expression, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/no license|not a valid SPDX expression/);
  });
});
