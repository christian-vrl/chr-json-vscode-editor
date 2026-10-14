// Spec 015 B7 (015 T5): the restoring wrapper around the library's query languages, beyond the
// corpus cases of criterion 8 (tests/query/library-languages.test.ts).
import { LosslessNumber } from '@chr-json-editor/core';
import { jsonpathQueryLanguage, type QueryLanguage } from 'vanilla-jsoneditor';
import { describe, expect, it } from 'vitest';
import {
  ambiguousMessage,
  bigNumberOrigins,
  exactNumbersLanguage,
  restoreBigNumbers,
} from '../src/query/exact-numbers.js';
import { EditorNumber, editorNumber } from '../src/editor-numbers.js';
import { parserFor } from '../src/parser.js';

const big = (text: string) => new LosslessNumber(text);
const own = (key: string, value: unknown) => {
  const object: Record<string, unknown> = {};
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return object;
};

/** A language that records what it was given and returns `result(json)`. */
function spy(result: (json: unknown) => unknown) {
  const calls: { json: unknown; query: string; parser: unknown }[] = [];
  const language: QueryLanguage = {
    id: 'spy',
    name: 'Spy',
    description: '',
    createQuery: () => '',
    executeQuery: (json, query, parser) => {
      calls.push({ json, query, parser });
      return result(json);
    },
  };
  return { calls, language: exactNumbersLanguage(language) };
}

describe('exactNumbersLanguage (spec 015 B7)', () => {
  it('runs the library language as it is on data with no big number', () => {
    const data = { a: [1, 2.5, -0] };
    const { calls, language } = spy((json) => json);
    const parser = parserFor('json');
    expect(language.executeQuery(data, 'q', parser)).toBe(data);
    expect(calls).toEqual([{ json: data, query: 'q', parser }]);
    expect(calls[0]!.json).toBe(data);
  });

  it('gives the language nearest numbers and leaves the input unchanged', () => {
    const id = new EditorNumber('12345678901234567890');
    const data = { id, list: [1, 2] };
    const { calls, language } = spy((json) => json);
    const result = language.executeQuery(data, 'q', parserFor('json'));
    expect(calls[0]!.json).toEqual({ id: Number('12345678901234567890'), list: [1, 2] });
    expect(data.id).toBe(id);
    expect((result as typeof data).id).toEqual(big('12345678901234567890'));
    // A container with no big number is not copied.
    expect((result as typeof data).list).toBe(data.list);
  });

  it("makes new big numbers with the page's factory, never the input's (a read-only proxy)", () => {
    // vanilla-jsoneditor's TransformModal hands executeQuery `readonlyProxy(json)`.
    const readonly = <T extends object>(target: T): T =>
      new Proxy(target, { get: (t, k, r) => wrap(Reflect.get(t, k, r)), set: () => false });
    const wrap = (v: unknown): unknown => (typeof v === 'object' && v !== null ? readonly(v) : v);
    const data = wrap([new EditorNumber('12345678901234567890'), 3]);
    const language = exactNumbersLanguage(jsonpathQueryLanguage, editorNumber);
    const [restored] = language.executeQuery(data, '$[0]', JSON) as unknown[];
    expect(restored).toBeInstanceOf(EditorNumber);
    expect(restored).toEqual(new EditorNumber('12345678901234567890'));
    expect(() => structuredClone(restored)).not.toThrow();
  });

  it('keeps a __proto__ key a member in a restored copy', () => {
    const data = own('__proto__', big('12345678901234567890'));
    const result = spy((json) => json).language.executeQuery(data, 'q', parserFor('json'));
    expect(Object.hasOwn(result as object, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect((result as Record<string, unknown>)['__proto__']).toEqual(big('12345678901234567890'));
  });

  it('restores a node reached twice once, keeping it shared', () => {
    const data = [{ id: big('12345678901234567890') }];
    const twice = spy((json) => [(json as unknown[])[0], (json as unknown[])[0]]).language;
    const [a, b] = twice.executeQuery(data, 'q', JSON) as unknown[];
    expect(a).toBe(b);
    expect(a).toEqual({ id: big('12345678901234567890') });
  });

  it('counts every result number that rounds from two different exact values', () => {
    const data = [big('12345678901234567890'), big('12345678901234567891'), 2, big('1e400')];
    const language = spy(() => [
      Number('12345678901234567890'),
      Number('12345678901234567890'),
      2,
    ]).language;
    expect(() => language.executeQuery(data, 'q', JSON)).toThrow(
      "2 numbers in this result can't be kept exact.",
    );
    expect(ambiguousMessage(1)).toBe("1 number in this result can't be kept exact.");
  });

  it('treats a big number and a plain number with the same nearest number as ambiguous', () => {
    const data = [9007199254740992, big('9007199254740993')];
    const language = spy(() => 9007199254740992).language;
    expect(() => language.executeQuery(data, 'q', JSON)).toThrow(ambiguousMessage(1));
  });

  it('keeps numbers equal by exact value as one value (spec 015 §Terms)', () => {
    // `100000000000000000000` is a big number whose exact value is the plain 1e20.
    const withPlain = [big('100000000000000000000'), 1e20];
    expect(spy(() => [1e20]).language.executeQuery(withPlain, 'q', JSON)).toEqual([1e20]);
    // Two spellings of one exact value restore to one of them, not an error.
    const spellings = [big('12345678901234567890'), big('1.234567890123456789e19')];
    expect(
      spy(() => Number('12345678901234567890')).language.executeQuery(spellings, 'q', JSON),
    ).toEqual(big('12345678901234567890'));
  });

  it('leaves a computed number no input number rounds to as it is', () => {
    const data = [big('12345678901234567890')];
    expect(spy(() => [42, 'x', null, true]).language.executeQuery(data, 'q', JSON)).toEqual([
      42,
      'x',
      null,
      true,
    ]);
  });

  it('runs JSONPath (Goessner) on the rounded copy, so its filters compare numbers', () => {
    const goessner = exactNumbersLanguage(jsonpathQueryLanguage);
    const data = [{ id: big('12345678901234567890') }, { id: big('1e400') }, { id: 3 }];
    expect(goessner.executeQuery(data, '$[?(@.id > 5)].id', JSON)).toEqual([
      big('12345678901234567890'),
      big('1e400'),
    ]);
  });

  it('restores overflow and underflow from their nearest numbers', () => {
    const data = { up: big('1e400'), down: big('-1E-400') };
    const origins = bigNumberOrigins(data)!;
    expect(restoreBigNumbers([Infinity, -0], origins)).toEqual([big('1e400'), big('-1E-400')]);
    expect(bigNumberOrigins({ a: [1, 2] })).toBeUndefined();
  });
});
