// Spike 011 T1: the smallest `runQuery` that answers the spike's questions. One fresh QuickJS
// runtime and context per run (spec 011 Terms), a memory limit and a deadline, Lodash evaluated
// inside the engine from its source text, the data passed in and out as JSON text. The full value
// bridge (Q2: -0, NaN, Infinity, __proto__, BigInt, cycles) is T3's; this one is plain JSON.
//
// APIs used, from quickjs-emscripten-core@0.32.0 dist/index.d.ts: newQuickJSWASMModuleFromVariant
// (:1830), shouldInterruptAfterDeadline (:1918), RuntimeOptionsBase.memoryLimitBytes and
// interruptHandler (:494-497), QuickJSWASMModule.newRuntime (:1707), QuickJSRuntime.newContext
// (:260), evalCode / callFunction / getString / setProp (:59-62), QuickJSContext.global (:1109).
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import lodashSource from 'lodash-source';

export const TIME_LIMIT_MS = 5000;
export const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
export const TIME_MESSAGE = 'The query was stopped after 5 seconds.';
export const MEMORY_MESSAGE = 'The query used more than 256 MiB and was stopped.';

export type Language = 'javascript' | 'lodash';

export class QueryError extends Error {
  constructor(
    message: string,
    /** The engine's own error, for the report. */
    readonly engineError?: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export interface RunTimings {
  /** Runtime and context created. */
  setupMs: number;
  /** Lodash's source evaluated in the context (0 for JavaScript). */
  lodashMs: number;
  /** JSON.stringify in the page and JSON.parse in the engine. */
  inputMs: number;
  /** The query text evaluated and `query(data)` called. */
  queryMs: number;
  /** JSON.stringify in the engine and JSON.parse in the page. */
  outputMs: number;
  totalMs: number;
}

export interface Engine {
  runQuery(language: Language, data: unknown, queryText: string): unknown;
  /** The same run, with where the time went. Throws QueryError like runQuery. */
  runQueryTimed(
    language: Language,
    data: unknown,
    queryText: string,
  ): { value: unknown; resultText: string; timings: RunTimings };
}

let loading: Promise<Engine> | undefined;
/** Compiles the engine's WebAssembly the first time it is called. */
export function loadEngine(): Promise<Engine> {
  loading ??= newQuickJSWASMModuleFromVariant(variant).then(createEngine);
  return loading;
}

/** The library's own Lodash check (vanilla-jsoneditor lodashQueryLanguage.ts, validate()). */
function validateLodash(query: string): void {
  const chainCount = query.match(/_\.chain\(/g)?.length;
  const valueCount = query.match(/\.value\(\)/g)?.length;
  if (chainCount !== valueCount) {
    throw new QueryError('Cannot execute query: Lodash _.chain(...) must end with .value()');
  }
}

/** The library's wrapper around the query text (javascriptQueryLanguage.ts, executeQuery()). */
function wrap(query: string): string {
  return (
    '(function () {\n"use strict";\n\n' +
    query +
    '\n\nif (typeof query !== "function") {\n' +
    '  throw new Error("Cannot execute query: expecting a function named \'query\' but is undefined")\n' +
    '}\n\nreturn query;\n})()'
  );
}

function createEngine(module: QuickJSWASMModule): Engine {
  function runQueryTimed(language: Language, data: unknown, queryText: string) {
    if (language === 'lodash') validateLodash(queryText);
    const t0 = performance.now();
    const deadline = Date.now() + TIME_LIMIT_MS;
    const runtime = module.newRuntime({
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      interruptHandler: shouldInterruptAfterDeadline(deadline),
    });
    const handles: QuickJSHandle[] = [];
    let context: QuickJSContext | undefined;
    const timings: RunTimings = {
      setupMs: 0,
      lodashMs: 0,
      inputMs: 0,
      queryMs: 0,
      outputMs: 0,
      totalMs: 0,
    };
    const fail = (error: unknown): never => {
      throw toQueryError(context, error, t0);
    };
    try {
      context = runtime.newContext();
      const ctx = context;
      const evaluate = (code: string): QuickJSHandle => {
        const result = ctx.evalCode(code);
        if (result.error) {
          handles.push(result.error);
          fail(result.error);
        }
        const value = (result as { value: QuickJSHandle }).value;
        handles.push(value);
        return value;
      };
      let t = performance.now();
      timings.setupMs = t - t0;

      if (language === 'lodash') {
        evaluate(lodashSource);
        timings.lodashMs = performance.now() - t;
        t = performance.now();
      }

      const text = ctx.newString(JSON.stringify(data) ?? 'null');
      handles.push(text);
      ctx.setProp(ctx.global, '__chrInput', text);
      const input = evaluate(
        '(function () { const t = globalThis.__chrInput; delete globalThis.__chrInput; return JSON.parse(t) })()',
      );
      timings.inputMs = performance.now() - t;
      t = performance.now();

      const queryFn = evaluate(wrap(queryText));
      const called = ctx.callFunction(queryFn, ctx.undefined, input);
      if (called.error) {
        handles.push(called.error);
        fail(called.error);
      }
      const output = (called as { value: QuickJSHandle }).value;
      handles.push(output);
      timings.queryMs = performance.now() - t;
      t = performance.now();

      ctx.setProp(ctx.global, '__chrOutput', output);
      const json = evaluate(
        '(function () { const v = globalThis.__chrOutput; delete globalThis.__chrOutput; return JSON.stringify(v === undefined ? null : v) })()',
      );
      const resultText = ctx.getString(json);
      const value: unknown = JSON.parse(resultText);
      timings.outputMs = performance.now() - t;
      timings.totalMs = performance.now() - t0;
      return { value, resultText, timings };
    } catch (error) {
      if (error instanceof QueryError) throw error;
      throw toQueryError(context, error, t0);
    } finally {
      for (const handle of handles) if (handle.alive) handle.dispose();
      context?.dispose();
      runtime.dispose();
    }
  }
  return {
    runQueryTimed,
    runQuery: (language, data, queryText) => runQueryTimed(language, data, queryText).value,
  };
}

/** Maps what the engine threw to the spec's messages. */
function toQueryError(ctx: QuickJSContext | undefined, error: unknown, t0: number): QueryError {
  let raw: string;
  if (ctx && isHandle(error)) {
    let dumped: unknown;
    try {
      dumped = ctx.dump(error);
    } catch (dumpError) {
      dumped = `(dump failed: ${String(dumpError)})`;
    }
    if (dumped && typeof dumped === 'object' && 'message' in dumped) {
      const { name, message } = dumped as { name?: unknown; message: unknown };
      raw = `${typeof name === 'string' ? name : 'Error'}: ${String(message)}`;
    } else {
      raw = typeof dumped === 'string' ? dumped : JSON.stringify(dumped);
    }
  } else {
    raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  if (/out of memory/i.test(raw)) return new QueryError(MEMORY_MESSAGE, raw);
  if (/interrupted/i.test(raw) || performance.now() - t0 >= TIME_LIMIT_MS)
    return new QueryError(TIME_MESSAGE, raw);
  return new QueryError(raw.replace(/^Error: /, ''), raw);
}

function isHandle(value: unknown): value is QuickJSHandle {
  return typeof value === 'object' && value !== null && 'alive' in value && 'dispose' in value;
}
