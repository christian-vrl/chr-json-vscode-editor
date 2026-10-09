// 004 T5: SchemaBinding applies spec 004's association rules to one document and keeps its
// DocumentValidation on the schema they name, over a fake document, settings and file system.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Format, SchemaSettingsScope } from '@chr-json-editor/core';
import type { SchemaDialect } from '@chr-json-editor/app-shell/protocol';
import {
  REMOTE_SCHEMA_REASON,
  SchemaBinding,
  parseSchema,
  topLevelSchema,
} from '../../src/schemaBinding';

const DOC = 'file:///work/data/people.json';
const PERSON = { type: 'object', required: ['name'] };

function setup(text: string, files: Record<string, string> = {}) {
  const state = {
    text,
    format: 'json' as Format,
    jsonSchemas: [] as SchemaSettingsScope[],
    json5Schemas: [] as SchemaSettingsScope[],
    files: { ...files },
  };
  const calls: (
    | ['setSchema', object | boolean | undefined, SchemaDialect | undefined]
    | ['setUnavailable', string]
  )[] = [];
  const reads: string[] = [];
  const binding = new SchemaBinding(
    {
      documentUri: () => DOC,
      text: () => state.text,
      format: () => state.format,
      settings: () => ({ jsonSchemas: state.jsonSchemas, json5Schemas: state.json5Schemas }),
      readFile: (uri) => {
        reads.push(uri);
        const content = state.files[uri];
        return content === undefined
          ? Promise.reject(new Error('not found'))
          : Promise.resolve(content);
      },
    },
    {
      setSchema: (schema, dialect) => calls.push(['setSchema', schema, dialect]),
      setUnavailable: (reason) => calls.push(['setUnavailable', reason]),
    },
  );
  return { state, calls, reads, binding };
}

describe('SchemaBinding', () => {
  afterEach(() => vi.useRealTimers());

  it("loads the file a document's relative $schema names (criterion 1, first rule)", async () => {
    const { calls, reads, binding } = setup('{"$schema": "../schemas/person.json", "name": "A"}', {
      'file:///work/schemas/person.json': JSON.stringify(PERSON),
    });
    await binding.refresh();
    expect(reads).toEqual(['file:///work/schemas/person.json']);
    expect(calls).toEqual([['setSchema', PERSON, undefined]]);
    expect(binding.schemaFile).toBe('file:///work/schemas/person.json');
  });

  it('reads a JSONC or JSON5 schema file in its own format', async () => {
    const { calls, binding } = setup('{"$schema": "./person.schema.json5"}', {
      'file:///work/data/person.schema.json5': "// note\n{type: 'object', required: ['name'],}",
    });
    await binding.refresh();
    expect(calls).toEqual([['setSchema', PERSON, undefined]]);
  });

  it('uses json.schemas, then json5.schemas, and an inline schema needs no file', async () => {
    const { state, calls, reads, binding } = setup('[]');
    state.json5Schemas = [{ entries: [{ fileMatch: ['*.json'], schema: { type: 'array' } }] }];
    await binding.refresh();
    state.jsonSchemas = [{ entries: [{ fileMatch: ['people.json'], schema: PERSON }] }];
    await binding.refresh();
    expect(reads).toEqual([]);
    expect(calls).toEqual([
      ['setSchema', { type: 'array' }, undefined],
      ['setSchema', PERSON, undefined],
    ]);
  });

  it('never fetches a remote schema and says so', async () => {
    const { state, calls, reads, binding } = setup('{}');
    state.jsonSchemas = [{ entries: [{ fileMatch: ['*.json'], url: 'https://example.com/s' }] }];
    await binding.refresh();
    expect(reads).toEqual([]);
    expect(calls).toEqual([['setUnavailable', `${REMOTE_SCHEMA_REASON}: https://example.com/s`]]);
  });

  it('says why a schema file cannot be used', async () => {
    const { state, calls, binding } = setup('{"$schema": "./missing.json"}', {
      'file:///work/data/broken.json': '{"type": ',
      'file:///work/data/list.json': '[]',
    });
    await binding.refresh();
    state.text = '{"$schema": "./broken.json"}';
    await binding.refresh();
    state.text = '{"$schema": "./list.json"}';
    await binding.refresh();
    expect(calls.map((c) => c[0])).toEqual(['setUnavailable', 'setUnavailable', 'setUnavailable']);
    expect(calls[0]?.[1]).toMatch(/^The schema file:\/\/\/work\/data\/missing.json cannot be read/);
    expect(calls[1]?.[1]).toMatch(/^The schema file:\/\/\/work\/data\/broken.json does not parse/);
    expect(calls[2]?.[1]).toMatch(/is not a JSON Schema/);
  });

  it('applies nothing new while the association stays the same, unless asked to reload', async () => {
    const uri = 'file:///work/data/s.json';
    const { state, calls, reads, binding } = setup('{"$schema": "./s.json", "a": 1}', {
      [uri]: '{}',
    });
    await binding.refresh();
    state.text = '{"$schema": "./s.json", "a": 2}';
    await binding.refresh();
    expect(reads).toHaveLength(1);
    state.files[uri] = '{"type": "object"}';
    await binding.refresh(true);
    expect(calls).toEqual([
      ['setSchema', {}, undefined],
      ['setSchema', { type: 'object' }, undefined],
    ]);
  });

  it('clears the schema once the document no longer has one', async () => {
    const { state, calls, binding } = setup('{"$schema": "./s.json"}', {
      'file:///work/data/s.json': '{}',
    });
    await binding.refresh();
    state.text = '{}';
    await binding.refresh();
    expect(calls).toEqual([
      ['setSchema', {}, undefined],
      ['setSchema', undefined, undefined],
    ]);
    expect(binding.schemaFile).toBeUndefined();
  });

  it('drops a slow read that a newer association replaced', async () => {
    let release: (text: string) => void = () => {};
    const { state, calls, binding } = setup('{"$schema": "./slow.json"}');
    const slow = new SchemaBinding(
      {
        documentUri: () => DOC,
        text: () => state.text,
        format: () => 'json',
        settings: () => ({ jsonSchemas: [], json5Schemas: [] }),
        readFile: () => new Promise((resolve) => (release = resolve)),
      },
      {
        setSchema: (schema, dialect) => calls.push(['setSchema', schema, dialect]),
        setUnavailable: (reason) => calls.push(['setUnavailable', reason]),
      },
    );
    const pending = slow.refresh();
    state.text = '{}';
    await slow.refresh();
    release('{"type": "string"}');
    await pending;
    expect(calls).toEqual([['setSchema', undefined, undefined]]);
    binding.dispose();
  });

  it("keeps the user's dialect for the schema, and resets it for a new one (UNK-017)", async () => {
    const { state, calls, binding } = setup('{}');
    state.jsonSchemas = [{ entries: [{ fileMatch: ['*.json'], schema: PERSON }] }];
    await binding.refresh();
    binding.setDialect('draft-04');
    state.text = '{"x": 1}';
    await binding.refresh();
    state.jsonSchemas = [{ entries: [{ fileMatch: ['*.json'], schema: { type: 'object' } }] }];
    await binding.refresh();
    expect(calls).toEqual([
      ['setSchema', PERSON, undefined],
      ['setSchema', PERSON, 'draft-04'],
      ['setSchema', { type: 'object' }, undefined],
    ]);
  });

  it('reads $schema with the format the document has now', async () => {
    const { state, calls, binding } = setup("{$schema: './s.json'}", {
      'file:///work/data/s.json': '{}',
    });
    await binding.refresh();
    expect(calls).toEqual([['setSchema', undefined, undefined]]);
    state.format = 'json5';
    await binding.refresh();
    expect(calls.at(-1)).toEqual(['setSchema', {}, undefined]);
  });

  it('coalesces scheduled refreshes', async () => {
    vi.useFakeTimers();
    const { state, calls, binding } = setup('{}');
    state.jsonSchemas = [{ entries: [{ fileMatch: ['*.json'], schema: PERSON }] }];
    binding.schedule();
    binding.schedule();
    expect(calls).toEqual([]);
    await vi.runAllTimersAsync();
    expect(calls).toEqual([['setSchema', PERSON, undefined]]);
    binding.schedule();
    binding.dispose();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });
});

describe('topLevelSchema', () => {
  it.each([
    ['{"$schema": "./a.json"}', 'json', './a.json'],
    ["// c\n{$schema: './a.json',}", 'json5', './a.json'],
    ['{"a": {"$schema": "./a.json"}}', 'json', undefined],
    ['[{"$schema": "./a.json"}]', 'json', undefined],
    ['{"$schema": ', 'json', undefined],
    ['{"$schema": 42}', 'json', 42],
  ] as const)('%s as %s', (text, format, expected) => {
    expect(topLevelSchema(text, format)).toBe(expected);
  });
});

describe('parseSchema', () => {
  it('accepts a boolean schema', () => {
    expect(parseSchema('file:///s.json', 'true')).toEqual({ schema: true });
  });
});
