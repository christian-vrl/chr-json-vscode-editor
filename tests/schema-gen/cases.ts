// Schema generation corpus (spec 016 criteria 1 and 2, 016 T1). One folder per case under
// tests/schema-gen/<case>/ with `case.json` (`format`, `dialect`, `tags`), one `input.<ext>` per
// format it names, and the hand-written `expected.schema.json`, or none for a `too-deep` case
// (G9's error). See README.md.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Format, GeneratedSchemaDialect } from '@chr-json-editor/core';
import vocabulary from './tags.json' with { type: 'json' };

export const schemaGenRoot = import.meta.dirname;
/** The tags criterion 2 requires a case for. */
export const schemaGenTags: readonly string[] = vocabulary.tags;

export interface SchemaGenInput {
  format: Format;
  file: string;
  text: string;
}

export interface SchemaGenCase {
  name: string;
  dialect: GeneratedSchemaDialect;
  tags: string[];
  /** One input per format in `case.json`'s `format` (several only for `same-data`). */
  inputs: SchemaGenInput[];
  /** `expected.schema.json`'s bytes, or `undefined` for a `too-deep` case. */
  expected: string | undefined;
}

interface CaseJson {
  format: Format | Format[];
  dialect: GeneratedSchemaDialect;
  tags: string[];
}

export function schemaGenCases(): SchemaGenCase[] {
  return readdirSync(schemaGenRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(schemaGenRoot, entry.name);
      const meta = JSON.parse(readFileSync(path.join(dir, 'case.json'), 'utf8')) as CaseJson;
      const formats = Array.isArray(meta.format) ? meta.format : [meta.format];
      const files = readdirSync(dir);
      return {
        name: entry.name,
        dialect: meta.dialect,
        tags: meta.tags,
        inputs: formats.map((format) => {
          const file = `input.${format}`;
          return { format, file, text: readFileSync(path.join(dir, file), 'utf8') };
        }),
        expected: files.includes('expected.schema.json')
          ? readFileSync(path.join(dir, 'expected.schema.json'), 'utf8')
          : undefined,
      };
    });
}
