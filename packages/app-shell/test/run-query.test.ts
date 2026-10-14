// 011 T3: runQuery's own rules beyond the corpus (spec 011 Q1–Q4, the limits and errors of criteria
// 5 and 6 as far as Node shows them; the dialog's side is 011 T4's web tests), and spec 015 B8's big
// numbers in the engine (015 T5).
import { LosslessNumber } from '@chr-json-editor/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeResult, encodeData } from '../src/query/bridge.js';
import {
  DEPTH_MESSAGE,
  CHAIN_MESSAGE,
  isQueryEngineLoaded,
  loadQueryEngine,
  MEMORY_MESSAGE,
  NOT_LOADED_MESSAGE,
  QueryError,
  runQuery,
  STACK_MESSAGE,
  TIME_MESSAGE,
  type QueryLanguageId,
} from '../src/query/run-query.js';

const loadEngine = () => import('../src/query/engine.js');
const languages: QueryLanguageId[] = ['javascript', 'lodash'];
const query = (body: string) => `function query (data) {\n  ${body}\n}`;

/** The QueryError a run throws; fails the test when it returns instead. */
function failure(language: QueryLanguageId, data: unknown, text: string): QueryError {
  try {
    runQuery(language, data, text);
  } catch (error) {
    expect(error).toBeInstanceOf(QueryError);
    return error as QueryError;
  }
  throw new Error('the query did not fail');
}

/** An own enumerable member, `__proto__` included. */
function own(key: string, value: unknown): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return object;
}

describe('runQuery before the engine is loaded', () => {
  it('throws a QueryError saying so', () => {
    expect(isQueryEngineLoaded()).toBe(false);
    expect(failure('javascript', [], query('return data')).message).toBe(NOT_LOADED_MESSAGE);
  });

  it('loads once', async () => {
    const first = loadQueryEngine(loadEngine);
    expect(loadQueryEngine(loadEngine)).toBe(first);
    await first;
    expect(isQueryEngineLoaded()).toBe(true);
  });
});

describe('runQuery (spec 011)', () => {
  it.each(languages)('Q1: %s gets a copy; changing it leaves the input alone', async (language) => {
    await loadQueryEngine(loadEngine);
    const data = { items: [{ n: 1 }, { n: 2 }] };
    const result = runQuery(
      language,
      data,
      query('data.items.push({ n: 3 }); data.items[0].n = 10; delete data.items[1]; return data'),
    );
    expect(data).toEqual({ items: [{ n: 1 }, { n: 2 }] });
    expect(result).toEqual({ items: [{ n: 10 }, null, { n: 3 }] });
  });

  it.each(languages)('Q2: %s keeps special numbers at any place, the root included', (language) => {
    for (const value of [-0, NaN, Infinity, -Infinity]) {
      expect(Object.is(runQuery(language, value, query('return data')), value)).toBe(true);
    }
    // A computed `['__proto__']` key is an own member, not the prototype.
    const data = { a: [1, -0, { b: NaN }], ['__proto__']: Infinity, c: -Infinity };
    const result = runQuery(language, data, query('return data')) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', '__proto__', 'c']);
    expect(result).toEqual(data);
    expect(Object.is((result.a as unknown[])[1], -0)).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('Q2: special numbers the query makes come out, also inside toJSON results', () => {
    const result = runQuery(
      'javascript',
      null,
      query('return { x: 0 / 0, y: [-0, 1 / 0], z: { toJSON() { return { w: -1 / 0 } } } }'),
    );
    expect(result).toEqual({ x: NaN, y: [-0, Infinity], z: { w: -Infinity } });
    expect(Object.is((result as { y: number[] }).y[0], -0)).toBe(true);
  });

  it('Q2: a __proto__ key the query makes is an own key in the result', () => {
    const result = runQuery(
      'javascript',
      null,
      query(
        'const o = {}; Object.defineProperty(o, "__proto__", { value: 1, enumerable: true }); return o',
      ),
    );
    expect(result).toEqual(own('__proto__', 1));
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('Q2: undefined, a function or a symbol as the result becomes null', () => {
    expect(runQuery('javascript', 1, query('return undefined'))).toBeNull();
    expect(runQuery('javascript', 1, query('return () => 1'))).toBeNull();
    expect(runQuery('javascript', 1, query('return Symbol("s")'))).toBeNull();
  });

  it('Q2 as amended by spec 015 B8: a BigInt is its digits; a value that contains itself is a QueryError', () => {
    expect(runQuery('javascript', 1, query('return [{ a: 1n }]'))).toEqual([{ a: 1 }]);
    expect(runQuery('javascript', 1, query('return -12345678901234567890n'))).toEqual(
      new LosslessNumber('-12345678901234567890'),
    );
    expect(failure('javascript', 1, query('const a = []; a.push([a]); return a')).message).toBe(
      'The result refers to itself.',
    );
    // Reached twice without a cycle: written twice, as JSON.stringify does (corpus reading 3).
    expect(runQuery('javascript', 1, query('const a = [1]; return [a, a]'))).toEqual([[1], [1]]);
  });

  it('Q3: the engine has the ECMAScript built-ins and, for Lodash, _; nothing else', () => {
    const names = [
      'window',
      'document',
      'self',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'importScripts',
      'postMessage',
      'acquireVsCodeApi',
      'require',
      'process',
      'setTimeout',
      'setInterval',
      'queueMicrotask',
      'console',
      'WebAssembly',
      'Worker',
      'navigator',
      'std',
      'os',
    ];
    const probe = query(`return [${names.map((n) => `typeof ${n}`).join(', ')}]`);
    for (const language of languages) {
      expect(runQuery(language, null, probe)).toEqual(names.map(() => 'undefined'));
    }
    expect(runQuery('javascript', null, query('return typeof _'))).toBe('undefined');
    expect(runQuery('lodash', null, query('return typeof _.chain'))).toBe('function');
    expect(
      runQuery(
        'javascript',
        null,
        query('return [typeof Date.now(), Math.random() < 1, eval("1 + 1")]'),
      ),
    ).toEqual(['number', true, 2]);
  });

  it('Q4: nothing a query stores on the global object reaches the next run', () => {
    expect(
      runQuery('javascript', null, query('globalThis.leaked = 42; return typeof leaked')),
    ).toBe('number');
    expect(runQuery('javascript', null, query('return typeof leaked'))).toBe('undefined');
  });

  it('locale methods ignore the locale: spec 011 §Where we differ', () => {
    const words = ['Zebra', 'apple', 'Ébano', 'Apple'];
    expect(
      runQuery(
        'javascript',
        words,
        query('return data.slice().sort((a, b) => a.localeCompare(b))'),
      ),
    ).toEqual(['Apple', 'Zebra', 'apple', 'Ébano']);
    expect(
      runQuery('javascript', null, query('return [typeof Intl, (1234567.891).toLocaleString()]')),
    ).toEqual(['undefined', '1234567.891']);
    // Lodash's own sorting compares with < and >, the same in both engines.
    expect(runQuery('lodash', words, query('return _.sortBy(data)'))).toEqual([...words].sort());
  });

  it('a query that replaces JSON or Map still gets its result written', () => {
    const result = runQuery(
      'javascript',
      null,
      query('JSON.stringify = () => "x"; JSON.parse = () => 0; Map = null; return { a: [NaN] }'),
    );
    expect(result).toEqual({ a: [NaN] });
  });

  it('criterion 6: errors carry their message, the library wording for its own checks', () => {
    expect(failure('javascript', 1, query('throw new Error("boom")')).message).toBe('boom');
    expect(failure('javascript', 1, query('throw new TypeError("bad")')).message).toBe(
      'TypeError: bad',
    );
    expect(failure('javascript', 1, query('throw "plain"')).message).toBe('plain');
    expect(failure('lodash', 1, query('return _.chain(data)')).message).toBe(CHAIN_MESSAGE);
    expect(failure('javascript', 1, 'const x = 1').message).toContain(
      "expecting a function named 'query'",
    );
  });

  it('evaluates the query text before moving the data in', () => {
    // Data that can't be written as JSON shows only once the query text is good.
    const data = { big: 1n };
    expect(failure('javascript', data, 'function query (data) {').message).toMatch(
      /expect|unexpected/,
    );
    expect(failure('javascript', data, query('return data')).message).toContain(
      "The data can't be passed to the query",
    );
    expect(isQueryEngineLoaded()).toBe(true);
  });

  it('criterion 5: a loop is stopped after 5 seconds and the next query runs', () => {
    const start = Date.now();
    expect(failure('javascript', 1, query('while (true) {}')).message).toBe(TIME_MESSAGE);
    expect(Date.now() - start).toBeLessThan(6000);
    expect(runQuery('javascript', [1, 2], query('return data.length'))).toBe(2);
  }, 10_000);

  it('criterion 5: a huge allocation is stopped at 256 MiB and the next query runs', () => {
    expect(failure('javascript', 1, query("return 'x'.repeat(2 ** 28)")).message).toBe(
      MEMORY_MESSAGE,
    );
    expect(runQuery('javascript', [1, 2], query('return data.length'))).toBe(2);
  });

  it('deep recursion fails with a plain message and the next query runs', () => {
    const error = failure('javascript', 1, query('const f = n => f(n + 1) + 1; return f(0)'));
    expect(error.message).toBe(STACK_MESSAGE);
    expect(error.engineError).toBe('InternalError: stack overflow');
    expect(runQuery('javascript', [1, 2], query('return data.length'))).toBe(2);
  });

  it('data nested past what the page can copy fails with a plain message', () => {
    let data: unknown = 1;
    for (let i = 0; i < 100_000; i++) data = [data];
    const error = failure('javascript', data, query('return 1'));
    expect(error.message).toBe(DEPTH_MESSAGE);
    expect(error.engineError).toMatch(/^RangeError/);
    expect(runQuery('javascript', [1, 2], query('return data.length'))).toBe(2);
  });
});

describe('the page half of the value bridge', () => {
  it('lists special numbers with their paths, and puts them back', () => {
    const data = { a: [-0, 1], b: own('__proto__', NaN) };
    const encoded = encodeData(data);
    expect(encoded.text).toBe('{"a":[0,1],"b":{"__proto__":null}}');
    expect(JSON.parse(encoded.specials)).toEqual([
      [['a', '0'], '-0'],
      [['b', '__proto__'], 'NaN'],
    ]);
    const back = decodeResult(encoded.text, encoded.specials);
    expect(back).toEqual(data);
    expect(Object.is((back as { a: number[] }).a[0], -0)).toBe(true);
  });

  it('handles a special number at the root and undefined data', () => {
    expect(encodeData(-Infinity)).toEqual({ text: 'null', specials: '[[[],"-Infinity"]]' });
    expect(decodeResult('null', '[[[],"-Infinity"]]')).toBe(-Infinity);
    expect(encodeData(undefined)).toEqual({ text: 'null', specials: '[]' });
  });
});

describe('the value bridge with big numbers (spec 015 B8)', () => {
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

  it('lists big numbers with their digits, and puts them back as big numbers', () => {
    const data = {
      id: big('12345678901234567890'),
      n: [big('1e400'), 5],
      p: own('__proto__', big('0.1000000000000000000001')),
    };
    const encoded = encodeData(data);
    expect(encoded.text).toBe('{"id":null,"n":[null,5],"p":{"__proto__":null}}');
    expect(JSON.parse(encoded.specials)).toEqual([
      [['id'], 'big', '12345678901234567890'],
      [['n', '0'], 'big', '1e400'],
      [['p', '__proto__'], 'big', '0.1000000000000000000001'],
    ]);
    expect(decodeResult(encoded.text, encoded.specials)).toEqual(data);
    expect(encodeData(big('-1e-400'))).toEqual({
      text: 'null',
      specials: '[[[],"big","-1e-400"]]',
    });
  });

  it('reads digits that fit a float as a plain number', () => {
    expect(
      decodeResult('[null,null]', '[[["0"],"big","5"],[["1"],"big","-9007199254740991"]]'),
    ).toEqual([5, -9007199254740991]);
  });

  it("keeps an object that looks like lossless-json's LosslessNumber an object", () => {
    const lookalike = { isLosslessNumber: true, value: '12345678901234567890' };
    expect(encodeData(lookalike).specials).toBe('[]');
    expect(runQuery('javascript', lookalike, query('return data'))).toEqual(lookalike);
  });
});

describe('big numbers in the engine (spec 015 B8, UNK-066)', () => {
  beforeAll(() => loadQueryEngine(loadEngine));
  const big = (text: string) => new LosslessNumber(text);
  const ids = [{ id: big('12345678901234567891') }, { id: 7 }, { id: big('12345678901234567890') }];

  it.each(languages)('%s: a big number is a LosslessNumber with its text and value', (language) => {
    const result = runQuery(
      language,
      [big('12345678901234567890'), big('0.1000000000000000000001'), big('1e400')],
      query(
        'const [a, b, c] = data; return [a.isLosslessNumber, a.value, String(a), `${b}`, typeof a.valueOf(), a.valueOf() === 12345678901234567890n, b.valueOf(), a.constructor.name, Object.isFrozen(c)]',
      ),
    );
    expect(result).toEqual([
      true,
      '12345678901234567890',
      '12345678901234567890',
      '0.1000000000000000000001',
      'bigint',
      true,
      0.1,
      'LosslessNumber',
      true,
    ]);
  });

  it.each(languages)('%s: <, > and + use its value; it comes back exact', (language) => {
    expect(
      runQuery(language, ids, query('return data.filter(d => d.id > 5).map(d => d.id)')),
    ).toEqual([big('12345678901234567891'), 7, big('12345678901234567890')]);
    expect(
      runQuery(language, ids, query('return data[0].id > data[2].id && data[1].id < data[0].id')),
    ).toBe(true);
    expect(runQuery(language, ids, query('return data[2].id + 1n'))).toEqual(
      big('12345678901234567891'),
    );
  });

  it('Lodash sorts by its value', () => {
    expect(runQuery('lodash', ids, query("return _.sortBy(data, 'id')"))).toEqual([
      ids[1],
      ids[2],
      ids[0],
    ]);
  });

  it.each(languages)("%s: overflow and underflow throw lossless-json's message", (language) => {
    expect(failure(language, { big: big('1e400') }, query('return data.big + 1')).message).toBe(
      "Cannot safely convert to number: the value '1e400' would overflow and become Infinity",
    );
    expect(
      failure(language, { small: big('-1E-400') }, query('return data.small * 2')).message,
    ).toBe("Cannot safely convert to number: the value '-1E-400' would underflow and become 0");
  });

  it.each(languages)('%s: mixing its BigInt with a number is the engine TypeError', (language) => {
    expect(failure(language, ids, query('return data[0].id + 1')).message).toMatch(/^TypeError: /);
  });

  it.each(languages)('%s: its digits are fixed; the class checks what it is given', (language) => {
    expect(
      runQuery(
        language,
        [big('12345678901234567890')],
        query(
          '"use strict"; try { data[0].value = "1" } catch (e) { return [String(e.name), data[0]] }',
        ),
      ),
    ).toEqual(['TypeError', big('12345678901234567890')]);
    expect(
      failure(
        language,
        [big('12345678901234567890')],
        query('return new data[0].constructor("abc")'),
      ).message,
    ).toBe('Invalid number (value: "abc")');
    expect(
      runQuery(
        language,
        [big('12345678901234567890')],
        query('return new data[0].constructor("98765432109876543210")'),
      ),
    ).toEqual(big('98765432109876543210'));
  });
});
