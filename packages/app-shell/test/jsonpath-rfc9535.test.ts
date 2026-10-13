// Spec 014 (014 T2): the JSONPath (RFC 9535) language object and its error mapping. The engine's
// own errors keep their message and position (criterion 6); P6's two cases, the engine's recursion
// limit and a JavaScript stack overflow, become one message. Criteria 1 and 2 (the compliance suite
// and the corpus) are tests/query/jsonpath-rfc9535.test.ts; criterion 4 is
// jsonpath-rfc9535.property.test.ts.
import { jsonpathQueryLanguage } from 'vanilla-jsoneditor';
import { describe, expect, it } from 'vitest';
import {
  jsonpathRfc9535QueryLanguage,
  MAX_RECURSION_DEPTH,
  TOO_DEEP_MESSAGE,
} from '../src/query/jsonpath-rfc9535.js';

const run = (data: unknown, query: string) =>
  jsonpathRfc9535QueryLanguage.executeQuery(data, query, JSON);

/** The error a call throws (fails the test when it returns). */
function thrownBy(call: () => unknown): Error {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected the call to throw');
}

/** `[[…[leaf]…]]`, `levels` arrays deep. */
function nested(levels: number, leaf: unknown = 1): unknown {
  let data = leaf;
  for (let i = 0; i < levels; i++) data = [data];
  return data;
}

describe('jsonpathRfc9535QueryLanguage (spec 014)', () => {
  it("is a library QueryLanguage with the library's JSONPath createQuery (P7)", () => {
    expect(jsonpathRfc9535QueryLanguage.id).toBe('jsonpath-rfc9535');
    expect(jsonpathRfc9535QueryLanguage.name).toBe('JSONPath (RFC 9535)');
    expect(jsonpathRfc9535QueryLanguage.createQuery).toBe(jsonpathQueryLanguage.createQuery);
  });

  it('names RFC 9535 and links to it in its description (criterion 5)', () => {
    expect(jsonpathRfc9535QueryLanguage.description).toContain('RFC 9535');
    expect(jsonpathRfc9535QueryLanguage.description).toContain(
      'href="https://www.rfc-editor.org/rfc/rfc9535"',
    );
  });

  it('gives an array of the nodelist values, the data itself unchanged (P2)', () => {
    const data = { a: { b: 1 }, list: [{ n: -0 }, { n: NaN }] };
    expect(run(data, '$.a.b')).toEqual([1]);
    expect(run(data, '$.zz')).toEqual([]);
    const items = run(data, '$.list[*]') as unknown[];
    expect(items[0]).toBe(data.list[0]);
    expect(Object.is((items[0] as { n: number }).n, -0)).toBe(true);
    expect(run(data, '$')).toEqual([data]);
  });

  it("keeps the engine's message and position for a syntax, type or function error (criterion 6)", () => {
    expect(thrownBy(() => run([], '$[?@.a')).message).toBe("unbalanced brackets ('$[?@.a':1)");
    expect(thrownBy(() => run([], '$[?length(@.*) < 3]')).message).toMatch(
      /^length\(\) argument 0 must be of ValueType \('.+':\d+\)$/,
    );
    expect(thrownBy(() => run([], '$[?foo(@)]')).message).toMatch(
      /^no such function 'foo' \('.+':\d+\)$/,
    );
  });

  it(`allows ${MAX_RECURSION_DEPTH - 1} levels under \`..\`, and gives P6's message beyond (P6)`, () => {
    expect(run(nested(MAX_RECURSION_DEPTH - 2), '$..*')).toHaveLength(MAX_RECURSION_DEPTH - 2);
    const error = thrownBy(() => run(nested(MAX_RECURSION_DEPTH), '$..*'));
    expect(error.message).toBe(TOO_DEEP_MESSAGE);
    expect((error.cause as Error).message).toContain('recursion limit reached');
  });

  it("gives P6's message for a JavaScript stack overflow while querying (P6)", () => {
    // Comparing two separate 100,000-level values recurses once per level.
    const error = thrownBy(() => run([nested(100_000), nested(100_000)], '$[?@ == $[1]]'));
    expect(error.message).toBe(TOO_DEEP_MESSAGE);
    expect(error.cause).toBeInstanceOf(RangeError);
  });

  it('passes any other error through unchanged', () => {
    const other = new RangeError('Invalid array length');
    const data = {
      get a(): never {
        throw other;
      },
    };
    expect(thrownBy(() => run(data, '$.*'))).toBe(other);
  });
});
