// 011 T4 (from the 011 T3 review): after the engine fails outside JavaScript, runQuery compiles a
// fresh one with the host's loader; meanwhile it says the engine is restarting, and once the fresh
// engine is in, the next run works. Its own file, so the module starts with no engine loaded.
import { expect, it } from 'vitest';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';
import {
  loadQueryEngine,
  QueryError,
  RESTARTING_MESSAGE,
  runQuery,
  type QueryEngineModule,
} from '../src/query/run-query.js';

const query = 'function query (data) {\n  return data.length\n}';

/** The real engine module, except that the first engine's contexts fail in the page. */
let compiled = 0;
const loader = async (): Promise<QueryEngineModule> => {
  const real = await import('../src/query/engine.js');
  return {
    lodashSource: real.lodashSource,
    createEngine: async () => {
      const engine = await real.createEngine();
      if (compiled++ > 0) return engine;
      return {
        newRuntime: (options) => {
          const runtime = engine.newRuntime(options);
          runtime.newContext = () => {
            throw new RangeError('Maximum call stack size exceeded');
          };
          return runtime;
        },
      } as QuickJSWASMModule;
    },
  };
};

function message(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(QueryError);
    return (error as QueryError).message;
  }
  throw new Error('the query did not fail');
}

it('a host failure restarts the engine; the run after the restart works', async () => {
  await loadQueryEngine(loader);
  expect(message(() => runQuery('javascript', [1, 2], query))).not.toBe(RESTARTING_MESSAGE);
  expect(message(() => runQuery('javascript', [1, 2], query))).toBe(RESTARTING_MESSAGE);
  await loadQueryEngine(loader);
  expect(compiled).toBe(2);
  expect(runQuery('javascript', [1, 2], query)).toBe(2);
});
