// generateSchema (spec 016, 016 T1) beyond the corpus in tests/schema-gen/: G9's boundary, which the
// corpus cannot hold as a file (a 1,000-level schema is megabytes), and own keys in the output.
import { describe, expect, it } from 'vitest';
import {
  generateSchema,
  MAX_SCHEMA_DEPTH,
  SCHEMA_TOO_DEEP_MESSAGE,
  SchemaTooDeepError,
} from '../src/index.js';

/** `levels` nested arrays (`[[1]]` is two) or objects, with `1` innermost. */
function nest(levels: number, kind: 'array' | 'object'): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i++) value = kind === 'array' ? [value] : { k: value };
  return value;
}

/** How many `items` or `properties.k` steps the schema goes down. */
function schemaDepth(schema: unknown): number {
  let depth = 0;
  for (let s = schema as Record<string, unknown> | undefined; s; depth++) {
    s = (s.items ?? (s.properties as Record<string, unknown> | undefined)?.k) as
      Record<string, unknown> | undefined;
  }
  return depth - 1;
}

describe('generateSchema depth (spec 016 G9)', () => {
  for (const kind of ['array', 'object'] as const) {
    it(`generates ${MAX_SCHEMA_DEPTH} nested ${kind}s`, () => {
      expect(schemaDepth(generateSchema(nest(MAX_SCHEMA_DEPTH, kind), 'draft-07'))).toBe(
        MAX_SCHEMA_DEPTH,
      );
    });

    it(`refuses ${MAX_SCHEMA_DEPTH + 1} nested ${kind}s`, () => {
      expect(() => generateSchema(nest(MAX_SCHEMA_DEPTH + 1, kind), 'draft-07')).toThrow(
        SchemaTooDeepError,
      );
    });
  }

  it('refuses very deep data with G9 rather than a stack overflow', () => {
    expect(() => generateSchema(nest(200_000, 'array'), 'draft-07')).toThrow(
      SCHEMA_TOO_DEEP_MESSAGE,
    );
  });

  it('counts depth from each JSON Lines item', () => {
    const line = nest(MAX_SCHEMA_DEPTH, 'object');
    expect(() => generateSchema([line, line], '2020-12', { lines: true })).not.toThrow();
    expect(() =>
      generateSchema([1, nest(MAX_SCHEMA_DEPTH + 1, 'object')], '2020-12', { lines: true }),
    ).toThrow(SchemaTooDeepError);
  });
});

describe('generateSchema keys (spec 016 G3)', () => {
  it('writes __proto__ as an own property of `properties`', () => {
    const data = JSON.parse('{"__proto__": {"x": 1}}') as unknown;
    const schema = generateSchema(data, 'draft-07');
    expect(Object.keys(schema.properties!)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(schema)) as unknown).toEqual(schema);
  });

  it('reads inherited names only when they are own keys', () => {
    expect(generateSchema([{}, { toString: 1 }], 'draft-07').items).toEqual({
      type: 'object',
      properties: { toString: { type: 'integer' } },
    });
  });
});
