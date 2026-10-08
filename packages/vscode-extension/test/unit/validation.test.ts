// Unit checks for 004 T2's host-side validation: Ajv's errors for a sample schema, documents that
// cannot be validated, and that every posted result names the document version it describes.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ValidationMessage } from '@chr-json-editor/app-shell/protocol';
import {
  DocumentValidation,
  compileSchema,
  formatOfPath,
  validateText,
} from '../../src/validation';

const fixtures = new URL('../../../../tests/e2e/fixtures/validation/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('person.schema.json', fixtures), 'utf8')) as object;
const invalid = readFileSync(new URL('person.jsonc', fixtures), 'utf8');

const keys = (result: ValidationMessage['result']) =>
  result.kind === 'errors'
    ? result.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword }))
    : result;

describe('validateText', () => {
  const validator = compileSchema(schema);

  it('reports every error of the sample document, sorted, with ajv-formats applied', () => {
    expect(keys(validateText(invalid, 'jsonc', validator))).toEqual([
      { instancePath: '/age', keyword: 'type' },
      { instancePath: '/email', keyword: 'format' },
      { instancePath: '/name', keyword: 'minLength' },
    ]);
    const result = validateText(invalid, 'jsonc', validator);
    expect(result.kind === 'errors' && result.errors[0]?.message).toBe('must be integer');
  });

  it('reports no errors for a valid document', () => {
    expect(validateText('{"name": "Ada", "age": 36}', 'json', validator)).toEqual({
      kind: 'errors',
      errors: [],
    });
  });

  it('reports errors at the root', () => {
    expect(keys(validateText('{"age": 1, "x": 0}', 'json', validator))).toEqual([
      { instancePath: '', keyword: 'additionalProperties' },
      { instancePath: '', keyword: 'required' },
    ]);
  });

  it('skips a document that does not parse', () => {
    expect(validateText('{"name": ', 'json', validator)).toMatchObject({ kind: 'skipped' });
    expect(validateText('', 'json', validator)).toMatchObject({ kind: 'skipped' });
  });

  it('skips JSON5 until its adapter exists (002 T5)', () => {
    expect(validateText("{name: 'Ada', age: 36}", 'json5', validator)).toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('json5') as unknown,
    });
  });
});

describe('compileSchema', () => {
  it('never loads a remote $ref: compiling throws instead (no loadSchema)', () => {
    expect(() => compileSchema({ $ref: 'https://example.com/schema.json' })).toThrow();
  });

  it('treats a schema without $schema as draft-07 (UNK-017)', () => {
    // `dependencies` is a draft-07 keyword (2019-09 split it into dependentRequired/Schemas).
    const validate = compileSchema({ dependencies: { a: ['b'] } });
    expect(validate({ a: 1 }).map((e) => e.keyword)).toEqual(['dependencies']);
  });
});

describe('DocumentValidation', () => {
  afterEach(() => vi.useRealTimers());

  function setup(initial: string) {
    const doc = { text: initial, docVersion: 1 };
    const posted: ValidationMessage[] = [];
    const validation = new DocumentValidation({
      snapshot: () => ({ ...doc }),
      format: 'json',
      post: (m) => posted.push(m),
    });
    return { doc, posted, validation };
  }

  it('posts nothing until it has a schema', () => {
    vi.useFakeTimers();
    const { posted, validation } = setup('{}');
    validation.schedule();
    validation.run();
    vi.runAllTimers();
    expect(posted).toEqual([]);
  });

  it('validates at once when the schema is set, keyed by the version it read', () => {
    const { posted, validation } = setup('{"name": "Ada", "age": 36}');
    validation.setSchema(schema);
    expect(posted).toEqual([
      { protocol: 2, type: 'validation', docVersion: 1, result: { kind: 'errors', errors: [] } },
    ]);
  });

  it('coalesces a burst of changes into one run on the latest version', () => {
    vi.useFakeTimers();
    const { doc, posted, validation } = setup('{"name": "Ada", "age": 36}');
    validation.setSchema(schema);
    for (const age of ['-1', '-2', '"x"']) {
      doc.text = `{"name": "Ada", "age": ${age}}`;
      doc.docVersion += 1;
      validation.schedule();
    }
    expect(posted).toHaveLength(1);
    vi.runAllTimers();
    expect(posted).toHaveLength(2);
    expect(posted[1]?.docVersion).toBe(4);
    expect(keys(posted[1]!.result)).toEqual([{ instancePath: '/age', keyword: 'type' }]);
  });

  it('reports a schema that does not compile as skipped', () => {
    const { posted, validation } = setup('{}');
    validation.setSchema({ $ref: 'https://example.com/schema.json' });
    expect(posted[0]?.result).toMatchObject({ kind: 'skipped' });
  });

  it('stops after dispose', () => {
    vi.useFakeTimers();
    const { posted, validation } = setup('{}');
    validation.setSchema(schema);
    validation.schedule();
    validation.dispose();
    vi.runAllTimers();
    expect(posted).toHaveLength(1);
  });
});

describe('formatOfPath', () => {
  it.each([
    ['/a/b.json', 'json'],
    ['/a/b.JSONC', 'jsonc'],
    ['/a/b.json5', 'json5'],
  ] as const)('%s → %s', (path, format) => expect(formatOfPath(path)).toBe(format));
});
