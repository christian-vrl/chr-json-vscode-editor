// Copy path corpus (spec 018 criteria 1 and 2, 018 T1). One folder per case under
// tests/paths/<case>/ with `case.json` (`format`, `tags`), `input.<format>` and the hand-written
// `expected.json`: the nodes at listed offsets and the places of listed paths. See README.md.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Format } from '@chr-json-editor/core';
import vocabulary from './tags.json' with { type: 'json' };

export const pathsRoot = import.meta.dirname;
/** The tags criterion 2 requires a case for. */
export const pathTags: readonly string[] = vocabulary.tags;

export type ExpectedNode =
  | { offset: number; jsonpath: string; pointer: string }
  | { offset: number; error: { line: number; column: number } };

export type ExpectedPlace = { pointer: string; offset: number } | { pointer: string; none: true };

export interface PathCase {
  name: string;
  format: Format;
  tags: string[];
  file: string;
  text: string;
  nodes: ExpectedNode[];
  places: ExpectedPlace[];
}

export function pathCases(): PathCase[] {
  return readdirSync(pathsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(pathsRoot, entry.name);
      const read = (file: string) => readFileSync(path.join(dir, file), 'utf8');
      const meta = JSON.parse(read('case.json')) as { format: Format; tags: string[] };
      const expected = JSON.parse(read('expected.json')) as {
        nodes: ExpectedNode[];
        places: ExpectedPlace[];
      };
      const file = `input.${meta.format}`;
      return { name: entry.name, ...meta, file, text: read(file), ...expected };
    });
}
