// The compare fixtures (spec 007 criterion 3): one folder per case with `left.<ext>`, `right.<ext>`
// and `expected.json`, the `Difference[]` of `compare(left, right)`. The extension names the
// side's format. Read by the dev host's unit test and by `pnpm test:web` (tests/web/compare.spec.ts).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type CompareFormat = 'json' | 'jsonc' | 'json5';

export interface CompareSideFixture {
  name: string;
  text: string;
  format: CompareFormat;
}

export interface CompareCase {
  name: string;
  left: CompareSideFixture;
  right: CompareSideFixture;
  expected: { kind: 'added' | 'removed' | 'changed'; leftPath?: string; rightPath?: string }[];
}

const DIR = __dirname;

function side(dir: string, base: 'left' | 'right'): CompareSideFixture {
  const file = readdirSync(dir).find(
    (f) => /^(left|right)\.(json|jsonc|json5)$/.test(f) && f.startsWith(`${base}.`),
  );
  if (!file) throw new Error(`tests/compare: ${dir} has no ${base}.json, .jsonc or .json5`);
  return {
    name: file,
    text: readFileSync(path.join(dir, file), 'utf8'),
    format: path.extname(file).slice(1) as CompareFormat,
  };
}

export function compareCases(): CompareCase[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(DIR, entry.name);
      return {
        name: entry.name,
        left: side(dir, 'left'),
        right: side(dir, 'right'),
        expected: JSON.parse(
          readFileSync(path.join(dir, 'expected.json'), 'utf8'),
        ) as CompareCase['expected'],
      };
    });
}
