// Spec 016 criterion 1 (016 T1): for every case in tests/schema-gen/, the schema file of
// `generateSchema(parseData(format, input), dialect)` is byte-equal to `expected.schema.json`, or
// (`too-deep`) the G9 error. For `jsonl` inputs the generator gets G8's `lines` option, since the
// items alone cannot tell a JSON Lines document from a JSON array.
//
// 016 T2: each input also passes its expected schema in spec 004's validator (criterion 3 on the
// corpus; `proto-key`'s `toString` and `hasOwnProperty` need `ownProperties: true`). A `jsonl`
// schema describes one line, so each item is validated.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateSchema, parseData, SchemaTooDeepError } from '@chr-json-editor/core';
import { compileSchema } from '../../packages/vscode-extension/src/validation';
import { schemaGenCases, schemaGenRoot } from './cases';

/** Spec 016 §Terms: the schema file is `JSON.stringify(schema, null, 2)` followed by `\n`. */
const schemaFile = (schema: unknown) => `${JSON.stringify(schema, null, 2)}\n`;

const G9 = 'The document is nested too deeply to generate a schema (more than 1,000 levels).';

describe('schema generation corpus (spec 016 criterion 1)', () => {
  const cases = schemaGenCases();

  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    for (const input of c.inputs) {
      it(`${c.name} (${input.file})`, () => {
        const parsed = parseData(input.format, input.text);
        if (!('data' in parsed)) throw new Error(`${input.file}: ${parsed.error.message}`);
        const generate = () =>
          generateSchema(parsed.data, c.dialect, { lines: input.format === 'jsonl' });
        if (c.tags.includes('too-deep')) {
          expect(c.expected).toBeUndefined();
          expect(generate).toThrow(SchemaTooDeepError);
          expect(generate).toThrow(G9);
          return;
        }
        expect(c.expected, 'expected.schema.json').toBeDefined();
        expect(schemaFile(generate())).toBe(c.expected);
      });
    }
  }

  for (const c of cases) {
    if (c.expected === undefined) continue;
    for (const input of c.inputs) {
      it(`${c.name} (${input.file}) passes its expected schema`, () => {
        const parsed = parseData(input.format, input.text);
        if (!('data' in parsed)) throw new Error(`${input.file}: ${parsed.error.message}`);
        const compiled = compileSchema(JSON.parse(c.expected!) as object);
        if (!compiled.ok) throw new Error(compiled.reason);
        const values = input.format === 'jsonl' ? (parsed.data as unknown[]) : [parsed.data];
        for (const value of values) expect(compiled.validate(value)).toEqual([]);
      });
    }
  }

  it('every case folder holds only its own files', () => {
    for (const c of cases) {
      const allowed = new Set([
        'case.json',
        'expected.schema.json',
        ...c.inputs.map((i) => i.file),
      ]);
      const extra = readdirSync(path.join(schemaGenRoot, c.name)).filter((f) => !allowed.has(f));
      expect(extra, c.name).toEqual([]);
    }
  });
});
