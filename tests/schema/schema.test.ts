// Spec 004 criteria 2 and 3 (004 T4). Criterion 2: every fixture under tests/schema/<dialect>/<case>/
// reports exactly its expected errors, with the dialect picked from the schema's own `$schema`
// (UNK-017). Criterion 3: a remote `$ref` is reported as not loaded (offline), and validating the
// whole corpus, remote `$ref`s included, makes zero network requests.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Format } from '@chr-json-editor/core';
import { FORMATS, SCHEMA_DIALECTS } from '@chr-json-editor/app-shell/protocol';
import {
  REMOTE_REF_REASON,
  compileSchema,
  selectDialect,
  validateText,
} from '../../packages/vscode-extension/src/validation';

const root = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

interface Case {
  dialect: string;
  name: string;
  schema: object | boolean;
  docFile: string;
  format: Format;
  expected: { instancePath: string; keyword: string }[];
}

const cases: Case[] = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((dialect) =>
    readdirSync(new URL(`${dialect.name}/`, root)).map((name) => {
      const dir = `${dialect.name}/${name}/`;
      const docFile = readdirSync(new URL(dir, root)).find((f) => f.startsWith('doc.'));
      if (!docFile) throw new Error(`${dir} has no doc.* file`);
      return {
        dialect: dialect.name,
        name,
        schema: JSON.parse(read(`${dir}schema.json`)) as object | boolean,
        docFile,
        format: docFile.slice('doc.'.length) as Format,
        expected: JSON.parse(read(`${dir}expected-errors.json`)) as Case['expected'],
      };
    }),
  );

const REMOTE_SCHEMAS: (object | boolean)[] = [
  { $ref: 'https://example.com/schema.json' },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'http://example.com/a#/x' },
  {
    $schema: 'https://json-schema.org/draft/2019-09/schema',
    properties: { a: { $ref: 'https://example.com/defs.json#/$defs/a' } },
  },
  // A relative `$ref` under an https `$id` resolves to a remote document too.
  { $id: 'https://example.com/root.json', properties: { a: { $ref: 'other.json' } } },
];

describe('spec 004 criterion 2: dialect fixtures', () => {
  it('has fixtures for every supported dialect, in all three formats', () => {
    expect([...new Set(cases.map((c) => c.dialect))].sort()).toEqual([...SCHEMA_DIALECTS].sort());
    // JSON Lines is not validated against a schema (spec 012 §Scope).
    expect([...new Set(cases.map((c) => c.format))].sort()).toEqual(
      FORMATS.filter((f) => f !== 'jsonl').sort(),
    );
  });

  it.each(cases.map((c) => [`${c.dialect}/${c.name} (${c.docFile})`, c] as const))(
    '%s',
    (_label, c) => {
      const sorted = [...c.expected].sort((a, b) =>
        a.instancePath === b.instancePath
          ? a.keyword.localeCompare(b.keyword)
          : a.instancePath.localeCompare(b.instancePath),
      );
      expect(c.expected, 'expected-errors.json must be sorted').toEqual(sorted);

      const compiled = compileSchema(c.schema);
      if (!compiled.ok) throw new Error(compiled.reason);
      expect(compiled.dialect).toEqual({
        name: c.dialect,
        assumed: c.name.startsWith('assumed-'),
        switchable: c.name.startsWith('assumed-'),
      });
      const result = validateText(
        read(`${c.dialect}/${c.name}/${c.docFile}`),
        c.format,
        compiled.validate,
      );
      expect(result.kind).toBe('errors');
      const errors = result.kind === 'errors' ? result.errors : [];
      expect(errors.map(({ instancePath, keyword }) => ({ instancePath, keyword }))).toEqual(
        c.expected,
      );
    },
  );

  it('assumes draft-07 only when $schema is missing, and the user can switch it', () => {
    const assumed = { name: 'draft-07', assumed: true, switchable: true };
    expect(selectDialect({ type: 'object' })).toEqual(assumed);
    expect(selectDialect(true)).toEqual(assumed);
    expect(selectDialect({}, '2020-12')).toEqual({
      name: '2020-12',
      assumed: false,
      switchable: true,
    });
    // A stated `$schema` wins over the switch.
    expect(
      selectDialect({ $schema: 'http://json-schema.org/draft-07/schema#' }, '2020-12'),
    ).toEqual({ name: 'draft-07', assumed: false, switchable: false });
  });

  it.each([
    ['http://json-schema.org/draft-07/schema#', 'draft-07'],
    ['http://json-schema.org/draft-07/schema', 'draft-07'],
    ['https://json-schema.org/draft-07/schema#', 'draft-07'],
    ['http://json-schema.org/draft-04/schema#', 'draft-04'],
    ['http://json-schema.org/draft-04/schema', 'draft-04'],
    ['http://json-schema.org/draft-06/schema#', 'draft-06'],
    ['https://json-schema.org/draft-06/schema', 'draft-06'],
    ['https://json-schema.org/draft/2019-09/schema', '2019-09'],
    ['https://json-schema.org/draft/2019-09/schema#', '2019-09'],
    ['https://json-schema.org/draft/2020-12/schema', '2020-12'],
    ['http://json-schema.org/draft/2020-12/schema#', '2020-12'],
  ])('reads $schema %s as %s, and it compiles', ($schema, name) => {
    expect(selectDialect({ $schema })).toEqual({ name, assumed: false, switchable: false });
    expect(compileSchema({ $schema, type: 'object' })).toMatchObject({ ok: true });
  });

  it.each([
    ['http://json-schema.org/draft-03/schema#', /^Schema draft not supported \(draft-03\)/],
    ['http://json-schema.org/draft-00/schema#', /^Schema draft not supported \(draft-00\)/],
    [42, /\$schema is not a string/],
  ])('does not validate with $schema %s', ($schema, reason) => {
    const compiled = compileSchema({ $schema });
    expect(compiled).toMatchObject({ ok: false, dialect: null });
    expect(!compiled.ok && compiled.reason).toMatch(reason);
  });

  it('runs an unknown $schema as assumed draft-07, or as the dialect switched to (UNK-031)', () => {
    const custom = { $schema: 'https://example.com/my-meta-schema', minimum: 1 };
    expect(compileSchema(custom)).toMatchObject({
      ok: true,
      dialect: { name: 'draft-07', assumed: true, switchable: true },
    });
    expect(selectDialect(custom, 'draft-04')).toEqual({
      name: 'draft-04',
      assumed: false,
      switchable: true,
    });
    const compiled = compileSchema(custom, '2020-12');
    expect(compiled.ok && compiled.validate(0).map((e) => e.keyword)).toEqual(['minimum']);
  });
});

describe('spec 004 criterion 3: offline', () => {
  // Every way Node code can reach the network, wrapped to record a call and refuse it.
  const require = createRequire(import.meta.url);
  const requests: string[] = [];
  const restore: (() => void)[] = [];

  function trap(target: Record<string, unknown>, key: string, label: string) {
    const original = target[key];
    target[key] = (...args: unknown[]) => {
      requests.push(`${label}(${String(args[0])})`);
      throw new Error(`network access during validation: ${label}`);
    };
    restore.push(() => (target[key] = original));
  }

  beforeAll(() => {
    for (const mod of ['http', 'https']) {
      trap(require(mod) as Record<string, unknown>, 'request', `${mod}.request`);
      trap(require(mod) as Record<string, unknown>, 'get', `${mod}.get`);
    }
    trap(require('http2') as Record<string, unknown>, 'connect', 'http2.connect');
    trap(require('net') as Record<string, unknown>, 'connect', 'net.connect');
    trap(require('net') as Record<string, unknown>, 'createConnection', 'net.createConnection');
    trap(require('tls') as Record<string, unknown>, 'connect', 'tls.connect');
    trap(require('dns') as Record<string, unknown>, 'lookup', 'dns.lookup');
    trap(globalThis, 'fetch', 'fetch');
  });

  afterAll(() => restore.splice(0).forEach((undo) => undo()));

  it.each(REMOTE_SCHEMAS.map((s) => [JSON.stringify(s), s] as const))(
    'reports %s as not loaded (offline)',
    (_label, schema) => {
      const compiled = compileSchema(schema);
      expect(compiled.ok).toBe(false);
      expect(!compiled.ok && compiled.reason).toMatch(
        new RegExp(`^${REMOTE_REF_REASON.replace(/[()]/g, '\\$&')}: https?://example\\.com/`),
      );
    },
  );

  it('the message is the one the spec names', () => {
    expect(REMOTE_REF_REASON).toBe('Remote schema references are not loaded (offline)');
  });

  it('records zero network requests across the whole corpus and the remote $refs', () => {
    for (const c of cases) {
      const compiled = compileSchema(c.schema);
      if (compiled.ok) compiled.validate(JSON.parse('{}'));
    }
    for (const schema of REMOTE_SCHEMAS) compileSchema(schema);
    expect(requests).toEqual([]);
  });

  it('the traps do record a request (so zero means none was made)', () => {
    expect(() => (globalThis.fetch as (u: string) => unknown)('https://example.com/')).toThrow();
    const https = require('https') as typeof import('node:https');
    expect(() => https.request('https://example.com/')).toThrow();
    expect(requests.splice(0)).toEqual([
      'fetch(https://example.com/)',
      'https.request(https://example.com/)',
    ]);
  });
});
