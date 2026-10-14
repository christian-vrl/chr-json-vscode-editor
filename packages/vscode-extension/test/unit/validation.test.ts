// Unit checks for 004 T2's host-side validation: Ajv's errors for a sample schema, documents that
// cannot be validated, and that every posted result names the document version it describes.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ValidationMessage } from '@chr-json-editor/app-shell/protocol';
import { generateSchema, LosslessNumber, parseData } from '@chr-json-editor/core';
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

  // Spec 015 criterion 7 (B6): Ajv validates big numbers as their nearest numbers, so an integer
  // schema accepts a big integer and an overflowing number neither throws nor passes `maximum`.
  it('validates big numbers as their nearest numbers, in every format', () => {
    const integer = validatorFor({ type: 'integer' });
    for (const format of ['json', 'jsonc', 'json5'] as const) {
      expect(validateText('12345678901234567890', format, integer)).toEqual({
        kind: 'errors',
        errors: [],
      });
    }
    const bounded = validatorFor({ type: 'array', items: { type: 'number', maximum: 5 } });
    expect(
      keys(validateText('[1e400, 1E-400, 0.1000000000000000000001]', 'json', bounded)),
    ).toEqual([{ instancePath: '/0', keyword: 'maximum' }]);
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

// Spec 016 criterion 4 (016 T2): the validator runs with `ownProperties: true` (004 criterion 2 as
// amended), so a schema naming inherited members checks the document's own keys only. That every
// tests/schema/ fixture keeps its expected errors with the option on is tests/schema/schema.test.ts.
describe('spec 016 criterion 4: inherited keys', () => {
  const schema = {
    properties: { constructor: { type: 'null' }, toString: { type: 'string' } },
    required: ['hasOwnProperty'],
  };
  const where = (errors: { instancePath: string; keyword: string }[]) =>
    errors.map(({ instancePath, keyword }) => ({ instancePath, keyword }));

  it('reports exactly one error, required at "", on {}', () => {
    expect(where(validatorFor(schema)({}))).toEqual([{ instancePath: '', keyword: 'required' }]);
  });

  it("without ownProperties Ajv reads {}'s inherited members instead (the error it fixes)", () => {
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    validate({});
    expect(where(validate.errors ?? [])).toEqual([
      { instancePath: '/constructor', keyword: 'type' },
      { instancePath: '/toString', keyword: 'type' },
    ]);
  });
});

// 016 T3 (from the #115 re-review): an own `__proto__` key holding a big number. compileSchema
// validates the data's nearest numbers (spec 015 B6); the copy it makes must keep `__proto__` an own
// member, or `required` fails. The criterion 3 property suite makes no big numbers, so this is the
// only test of the two together.
describe('an own __proto__ key holding a big number', () => {
  const parsed = parseData('json', '{"__proto__": 12345678901234567890, "constructor": 1}');
  if (!('data' in parsed)) throw new Error(parsed.error.message);
  const data = parsed.data as object;

  it('is an own member holding a LosslessNumber', () => {
    expect(Object.getOwnPropertyDescriptor(data, '__proto__')?.value).toBeInstanceOf(
      LosslessNumber,
    );
  });

  it('passes its generated schema, which requires it', () => {
    const generated = generateSchema(data, 'draft-07');
    expect(generated.required).toEqual(['__proto__', 'constructor']);
    expect(validatorFor(generated)(data)).toEqual([]);
  });

  it('meets required and the sibling checks; its absence is a required error', () => {
    const validate = validatorFor({
      required: ['__proto__', 'constructor'],
      properties: { constructor: { type: 'integer', maximum: 1 } },
    });
    expect(validate(data)).toEqual([]);
    expect(validate({ constructor: 1 }).map((e) => e.keyword)).toEqual(['required']);
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

  it('while paused, runs only on runOnce, from the data alone (spec 008 criterion 10)', () => {
    vi.useFakeTimers();
    const doc = { text: '{"name": "Ada", "age": 36}', docVersion: 1 };
    const posted: ValidationMessage[] = [];
    let paused = true;
    let changes = 0;
    const validation = new DocumentValidation({
      snapshot: () => ({ ...doc }),
      format: () => 'json',
      paused: () => paused,
      post: (m) => posted.push(m),
      schemaChanged: () => changes++,
    });
    expect(validation.paused).toBe(false);
    validation.setSchema(schema);
    expect(changes).toBe(1);
    expect(validation.paused).toBe(true);
    doc.text = '{"name": "Ada", "age": -1}';
    doc.docVersion = 2;
    validation.schedule();
    validation.run();
    vi.runAllTimers();
    expect(posted).toEqual([]);
    validation.runOnce();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.docVersion).toBe(2);
    expect(keys(posted[0]!.result)).toEqual([{ instancePath: '/age', keyword: 'minimum' }]);
    // A schema that cannot be used is reported without a parse, paused or not.
    validation.setUnavailable('Remote schemas are not loaded (offline)');
    expect(validation.paused).toBe(false);
    expect(posted[1]?.result).toEqual({
      kind: 'skipped',
      reason: 'Remote schemas are not loaded (offline)',
    });
    paused = false;
    validation.setSchema(schema);
    expect(posted).toHaveLength(3);
    validation.setSchema(undefined);
    expect(changes).toBe(4);
  });

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

  it('with validation off, posts nothing, never pauses, and clears or validates on a switch (spec 019 V1, A5)', () => {
    vi.useFakeTimers();
    const doc = { text: '{"name": "Ada", "age": -1}', docVersion: 1 };
    const posted: ValidationMessage[] = [];
    let enabled = false;
    let changes = 0;
    const validation = new DocumentValidation({
      snapshot: () => ({ ...doc }),
      format: () => 'json',
      enabled: () => enabled,
      paused: () => true,
      post: (m) => posted.push(m),
      schemaChanged: () => changes++,
    });
    validation.setSchema(schema);
    validation.schedule();
    validation.run();
    validation.runOnce();
    vi.runAllTimers();
    expect(posted).toEqual([]);
    // Off, no "Schema validation paused" item either (spec 008 criterion 10's item reads this).
    expect(validation.paused).toBe(false);
    // Nothing changed: no event, nothing posted.
    validation.enabledChanged();
    expect(posted).toEqual([]);
    changes = 0;

    // Turned on: the document validates at once, here as a paused large file does: not at all
    // until the click, and the item shows.
    enabled = true;
    validation.enabledChanged();
    expect(changes).toBe(1);
    expect(validation.paused).toBe(true);
    validation.runOnce();
    expect(keys(posted.at(-1)!.result)).toEqual([{ instancePath: '/age', keyword: 'minimum' }]);

    // Turned off: one `none` with no dialect, so the errors and the "assumed draft-07" notice go.
    enabled = false;
    validation.enabledChanged();
    expect(changes).toBe(2);
    expect(posted.at(-1)).toMatchObject({ dialect: null, result: { kind: 'none' } });
    const count = posted.length;
    validation.setSchema(undefined);
    validation.setSchema(schema);
    validation.setUnavailable('unreadable');
    vi.runAllTimers();
    expect(posted).toHaveLength(count);
  });

  it('does not ask whether validation is on while it is being built (the tab is not ready yet)', () => {
    let ready = false;
    const validation = new DocumentValidation({
      snapshot: () => ({ text: '{}', docVersion: 1 }),
      format: () => 'json',
      enabled: () => {
        if (!ready) throw new Error('asked before the tab was ready');
        return true;
      },
      post: () => {},
    });
    ready = true;
    validation.setSchema(schema);
  });

  it('validates at once when turned on with the tab open (spec 019 A5)', () => {
    let enabled = false;
    const posted: ValidationMessage[] = [];
    const validation = new DocumentValidation({
      snapshot: () => ({ text: '{"name": "Ada", "age": -1}', docVersion: 3 }),
      format: () => 'json',
      enabled: () => enabled,
      post: (m) => posted.push(m),
    });
    validation.setSchema(schema);
    expect(posted).toEqual([]);
    enabled = true;
    validation.enabledChanged();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      docVersion: 3,
      dialect: { name: 'draft-07', assumed: true, switchable: true },
    });
    expect(keys(posted[0]!.result)).toEqual([{ instancePath: '/age', keyword: 'minimum' }]);
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
