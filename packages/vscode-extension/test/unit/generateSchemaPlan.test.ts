// Unit checks for 016 T3's "Generate JSON Schema" plan (spec 016 criteria 5–7): the schema file, its
// name, criterion 6's message, criterion 7's notification and `json.schemas` entry, and that every
// dialect the generator writes is one spec 004's validator selects by name (#111 review: core's
// `GeneratedSchemaDialect` and app-shell's `SchemaDialect` stay separate types, as core cannot import
// app-shell; this keeps them agreeing).
import { describe, expect, it } from 'vitest';
import { GENERATED_SCHEMA_URI, type GeneratedSchemaDialect } from '@chr-json-editor/core';
import { SCHEMA_DIALECTS, type SchemaDialect } from '@chr-json-editor/app-shell/protocol';
import {
  brokenSchemaMessage,
  COMMAND_DIALECT,
  generatedMessage,
  linkButton,
  planSchema,
  schemaLink,
  schemaName,
  withSchemaLink,
} from '../../src/generateSchemaPlan';
import { compileSchema } from '../../src/validation';

describe('planSchema', () => {
  it('writes the draft-07 schema file (UNK-069): two-space JSON and a final newline', () => {
    expect(COMMAND_DIALECT).toBe('draft-07');
    expect(planSchema('{"a": 1, "b": [true]}', 'json')).toEqual({
      kind: 'schema',
      text:
        '{\n  "$schema": "http://json-schema.org/draft-07/schema#",\n  "type": "object",\n' +
        '  "properties": {\n    "a": {\n      "type": "integer"\n    },\n    "b": {\n' +
        '      "type": "array",\n      "items": {\n        "type": "boolean"\n      }\n' +
        '    }\n  },\n  "required": [\n    "a",\n    "b"\n  ]\n}\n',
      documentSchema: undefined,
    });
  });

  it('gives the same schema file for the same data in every format (G7)', () => {
    const json = planSchema('{"a": [1, 2.5]}', 'json');
    expect(planSchema('{\n  // c\n  "a": [1, 2.5,],\n}', 'jsonc')).toEqual(json);
    expect(planSchema('{a: [0x1, 2.5]}', 'json5')).toEqual(json);
  });

  it("reads the data's own top-level $schema, for spec 004's resolver", () => {
    const plan = planSchema('{"$schema": "./s.json", "a": 1}', 'json');
    expect(plan.kind === 'schema' && plan.documentSchema).toBe('./s.json');
    const inArray = planSchema('[{"$schema": "./s.json"}]', 'json');
    expect(inArray.kind === 'schema' && inArray.documentSchema).toBeUndefined();
  });

  it('gives the error offset of a broken document, past a byte order mark', () => {
    expect(planSchema('{"a": }', 'json')).toEqual({ kind: 'broken', offset: 6 });
    expect(planSchema('﻿{"a": }', 'json')).toEqual({ kind: 'broken', offset: 7 });
    expect(planSchema('﻿{"a": 1}', 'json').kind).toBe('schema');
  });

  it('describes one line of a JSON Lines document (G8)', () => {
    const plan = planSchema('{"a": 1}\n{"a": "x"}\n', 'jsonl');
    expect(plan.kind === 'schema' && JSON.parse(plan.text)).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { a: { type: ['string', 'integer'] } },
      required: ['a'],
    });
  });

  it('refuses data nested more than 1,000 levels (G9)', () => {
    expect(planSchema(`${'['.repeat(1001)}${']'.repeat(1001)}`, 'json')).toEqual({
      kind: 'too-deep',
      message: 'The document is nested too deeply to generate a schema (more than 1,000 levels).',
    });
  });
});

describe('names and messages', () => {
  it('names the schema file after the source (criterion 5)', () => {
    expect(schemaName('data.json5')).toBe('data.schema.json');
    expect(schemaName('data.json')).toBe('data.schema.json');
    expect(schemaName('a.b.jsonc')).toBe('a.b.schema.json');
    expect(schemaName('data')).toBe('data.schema.json');
    expect(schemaName('.json')).toBe('.json.schema.json');
  });

  it("words criterion 6's message as spec 006 criterion 7 does", () => {
    expect(brokenSchemaMessage('json5', 2, 8)).toBe(
      "CHR JSON Editor: can't generate a JSON Schema: the document is not valid JSON5 (error at " +
        'line 2, column 8). Fix it or run "Repair JSON" first.',
    );
    expect(brokenSchemaMessage('jsonl', 1, 1)).toMatch(/not valid JSON Lines .*"Repair Lines"/);
  });

  it("words criterion 7's notification and button", () => {
    expect(generatedMessage('data.schema.json', 'data.json5')).toBe(
      'Generated data.schema.json from data.json5.',
    );
    expect(linkButton('data.json5')).toBe('Use for data.json5');
  });
});

describe('schemaLink and withSchemaLink (criterion 7)', () => {
  it('makes both paths relative to the folder, with / separators', () => {
    expect(schemaLink('/w', '/w/sub/data.json5', '/w/sub/data.schema.json')).toEqual({
      fileMatch: ['/sub/data.json5'],
      url: './sub/data.schema.json',
    });
    expect(schemaLink('/', '/data.json', '/data.schema.json')).toEqual({
      fileMatch: ['/data.json'],
      url: './data.schema.json',
    });
  });

  it('gives no link when the document or the schema is outside the folder', () => {
    expect(schemaLink('/w', '/other/data.json', '/w/data.schema.json')).toBeUndefined();
    expect(schemaLink('/w', '/w/data.json', '/elsewhere/data.schema.json')).toBeUndefined();
    expect(schemaLink('/w', '/wx/data.json', '/wx/data.schema.json')).toBeUndefined();
  });

  it('appends the entry and keeps the existing ones', () => {
    const link = { fileMatch: ['/a.json'] as [string], url: './a.schema.json' };
    const existing = [{ fileMatch: ['*.x.json'], url: './x.json' }];
    expect(withSchemaLink(existing, link)).toEqual([...existing, link]);
    expect(existing).toHaveLength(1);
    expect(withSchemaLink(undefined, link)).toEqual([link]);
  });
});

describe('generated dialects and the validator', () => {
  // Fails to type-check if core's generator grows a dialect spec 004's validator does not name.
  const asValidatorDialect = (dialect: GeneratedSchemaDialect): SchemaDialect => dialect;

  it('selects each generated `$schema` URI by name, not assumed (spec 016 §Terms)', () => {
    const dialects = Object.keys(GENERATED_SCHEMA_URI) as GeneratedSchemaDialect[];
    expect(dialects).toContain(COMMAND_DIALECT);
    for (const dialect of dialects) {
      expect(SCHEMA_DIALECTS).toContain(asValidatorDialect(dialect));
      const compiled = compileSchema({ $schema: GENERATED_SCHEMA_URI[dialect] });
      expect(compiled.dialect).toEqual({ name: dialect, assumed: false, switchable: false });
    }
  });
});
