// Unit checks for 004 T2's host-side validation: Ajv's errors for a sample schema, documents that
// cannot be validated, and that every posted result names the document version it describes.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ValidationMessage } from '@chr-json-editor/app-shell/protocol';
import { DocumentValidation, compileSchema, validateText } from '../../src/validation';

const fixtures = new URL('../../../../tests/e2e/fixtures/validation/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('person.schema.json', fixtures), 'utf8')) as object;
const invalid = readFileSync(new URL('person.jsonc', fixtures), 'utf8');

const keys = (result: ValidationMessage['result']) =>
  result.kind === 'errors'
    ? result.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword }))
    : result;

function validatorFor(source: object | boolean) {
  const compiled = compileSchema(source);
  if (!compiled.ok) throw new Error(compiled.reason);
  return compiled.validate;
}

describe('validateText', () => {
  const validator = validatorFor(schema);

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

  it('validates JSON5 with its own parser', () => {
    expect(keys(validateText("{name: 'Ada', age: 1.5, /* note */}", 'json5', validator))).toEqual([
      { instancePath: '/age', keyword: 'type' },
    ]);
  });
});

describe('compileSchema', () => {
  it('never loads a remote $ref: it reports the offline message instead (no loadSchema)', () => {
    expect(compileSchema({ $ref: 'https://example.com/schema.json' })).toEqual({
      ok: false,
      dialect: { name: 'draft-07', assumed: true, switchable: true },
      reason: 'Remote schema references are not loaded (offline): https://example.com/schema.json',
    });
  });

  it('treats a schema without $schema as draft-07 (UNK-017)', () => {
    // `dependencies` is a draft-07 keyword (2019-09 split it into dependentRequired/Schemas).
    const validate = validatorFor({ dependencies: { a: ['b'] } });
    expect(validate({ a: 1 }).map((e) => e.keyword)).toEqual(['dependencies']);
  });
});

describe('DocumentValidation', () => {
  afterEach(() => vi.useRealTimers());

  let format: 'json' | 'jsonc' | 'json5' = 'json';
  afterEach(() => {
    format = 'json';
  });

  function setup(initial: string) {
    const doc = { text: initial, docVersion: 1 };
    const posted: ValidationMessage[] = [];
    const validation = new DocumentValidation({
      snapshot: () => ({ ...doc }),
      format: () => format,
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
      {
        protocol: PROTOCOL_VERSION,
        type: 'validation',
        docVersion: 1,
        dialect: { name: 'draft-07', assumed: true, switchable: true },
        result: { kind: 'errors', errors: [] },
      },
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
    validation.setSchema({ type: 'object', properties: { a: { $ref: '#/missing' } } });
    expect(posted[0]?.result).toMatchObject({
      kind: 'skipped',
      reason: expect.stringMatching(/^The schema does not compile: /) as unknown,
    });
  });

  it('reports a remote $ref as skipped with the offline message (spec 004 criterion 3)', () => {
    const { posted, validation } = setup('{}');
    validation.setSchema({ $ref: 'https://example.com/schema.json' });
    expect(posted[0]?.result).toEqual({
      kind: 'skipped',
      reason: 'Remote schema references are not loaded (offline): https://example.com/schema.json',
    });
  });

  it('runs a schema without $schema as the dialect the user switched to (UNK-017)', () => {
    const { posted, validation } = setup('{"a": 1}');
    const noSchema = { dependentRequired: { a: ['b'] } };
    validation.setSchema(noSchema);
    expect(posted[0]).toMatchObject({
      dialect: { name: 'draft-07', assumed: true, switchable: true },
      result: { kind: 'errors', errors: [] },
    });
    validation.setSchema(noSchema, '2019-09');
    expect(posted[1]?.dialect).toEqual({ name: '2019-09', assumed: false, switchable: true });
    expect(keys(posted[1]!.result)).toEqual([{ instancePath: '', keyword: 'dependentRequired' }]);
  });

  it('posts no dialect and skips a schema whose draft is not supported', () => {
    const { posted, validation } = setup('{}');
    validation.setSchema({ $schema: 'http://json-schema.org/draft-03/schema#' });
    expect(posted[0]).toMatchObject({
      dialect: null,
      result: {
        kind: 'skipped',
        reason: expect.stringMatching(/^Schema draft not supported/) as unknown,
      },
    });
  });

  it('parses with the format the document has now (a format badge switch, 004 T5)', () => {
    const { posted, validation } = setup("{name: 'Ada', age: 36}");
    validation.setSchema(schema);
    expect(posted[0]?.result).toMatchObject({ kind: 'skipped' });
    format = 'json5';
    validation.run();
    expect(posted[1]?.result).toEqual({ kind: 'errors', errors: [] });
  });

  it('tells the webview once when the schema goes away, and nothing when there was none', () => {
    const { posted, validation } = setup('{}');
    validation.setSchema(undefined);
    expect(posted).toEqual([]);
    validation.setSchema(schema);
    validation.setSchema(undefined);
    validation.setSchema(undefined);
    expect(posted.slice(1)).toEqual([
      {
        protocol: PROTOCOL_VERSION,
        type: 'validation',
        docVersion: 1,
        dialect: null,
        result: { kind: 'none' },
      },
    ]);
    validation.run();
    expect(posted).toHaveLength(2);
  });

  it('reports a schema that cannot be used on every run', () => {
    const { doc, posted, validation } = setup('{}');
    validation.setUnavailable('The schema file was not found');
    doc.docVersion = 2;
    validation.run();
    expect(posted.map((m) => [m.docVersion, m.dialect, m.result])).toEqual([
      [1, null, { kind: 'skipped', reason: 'The schema file was not found' }],
      [2, null, { kind: 'skipped', reason: 'The schema file was not found' }],
    ]);
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
