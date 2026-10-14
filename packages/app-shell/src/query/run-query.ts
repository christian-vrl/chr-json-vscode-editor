// JavaScript and Lodash queries in a sealed engine (spec 011, ADR-011, UNK-048 ★): QuickJS compiled
// to WebAssembly, one fresh runtime and context per run, a 5-second deadline and a 256 MiB memory
// limit. `runQuery` is synchronous, as the library's `QueryLanguage.executeQuery` is; the engine's
// WebAssembly is compiled once, by `loadQueryEngine`, before the first run (criterion 10, 011 T4).
// The WebAssembly and Lodash's source live in ./engine.ts, which the host loads lazily and passes
// in, so this module adds only QuickJS's small JavaScript wrapper types to the page's bundle.
//
// APIs used, from quickjs-emscripten-core@0.32.0 dist/index.d.ts: newQuickJSWASMModuleFromVariant
// (:1830), RuntimeOptionsBase.interruptHandler / memoryLimitBytes (:494-497),
// QuickJSWASMModule.newRuntime (:1707), QuickJSRuntime.newContext (:260), QuickJSContext.evalCode,
// callFunction (:1495), newString (:1117), getString (:1330), getProp (:1392), dump.
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from 'quickjs-emscripten-core';
import { decodeResult, encodeData } from './bridge.js';
import { CYCLE_SENTINEL, ENGINE_HELPERS, wrapQuery } from './engine-source.js';

export type QueryLanguageId = 'javascript' | 'lodash';

export const TIME_LIMIT_MS = 5000;
export const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
/**
 * The engine's own stack limit. Without one, deep recursion in a query overflows the page's stack
 * inside the WebAssembly, which leaves the runtime unusable. The engine's frames take several times
 * their own stack size on the page's stack, so the limit is kept small: at 64 KiB a query recurses
 * about 370 calls deep and the page can already be about 40% into its own stack, against about
 * 740 calls and 15% at 128 KiB (measured in Node 22 with a page stack of about 12,300 frames).
 */
export const MAX_STACK_BYTES = 64 * 1024;
export const TIME_MESSAGE = 'The query was stopped after 5 seconds.';
export const MEMORY_MESSAGE = 'The query used more than 256 MiB and was stopped.';
export const CYCLE_MESSAGE = 'The result refers to itself.';
export const NOT_LOADED_MESSAGE = 'The query engine is not loaded yet.';
/** A run after the engine failed outside JavaScript, while a fresh one compiles (011 T4). */
export const RESTARTING_MESSAGE = 'The query engine is restarting. Try the query again.';
/** The engine's own stack limit was hit (`InternalError: stack overflow`, 011 T3 review). */
export const STACK_MESSAGE = 'The query recursed too deeply and was stopped.';
/** The data is nested deeper than the page can copy it into the engine (011 T3 review). */
export const DEPTH_MESSAGE = 'The data is nested too deeply to pass to the query.';
/** The library's own messages (vanilla-jsoneditor 3.13.0 lodashQueryLanguage / javascriptQueryLanguage). */
export const CHAIN_MESSAGE = 'Cannot execute query: Lodash _.chain(...) must end with .value()';

/** What a query run throws; `message` is what the Transform dialog's preview shows (criterion 6). */
export class QueryError extends Error {
  constructor(
    message: string,
    /** The engine's own error text, when the message replaces it. */
    readonly engineError?: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

/** What ./engine.ts exports; the host imports it lazily and hands it to `loadQueryEngine`. */
export interface QueryEngineModule {
  createEngine(): Promise<QuickJSWASMModule>;
  lodashSource: string;
}

/** How a host gets ./engine.ts: `() => import(…)` of its chunk or its webview URI. */
export type QueryEngineLoader = () => Promise<QueryEngineModule>;

let engine: QuickJSWASMModule | undefined;
let lodashSource = '';
let loading: Promise<void> | undefined;
/** The loader of the last `loadQueryEngine`, for compiling a fresh engine after a host failure. */
let lastLoader: QueryEngineLoader | undefined;
/** A fresh engine is compiling because the last one failed outside JavaScript. */
let restarting = false;

/**
 * Loads ./engine.ts with `load` and compiles the engine's WebAssembly; later calls return the same
 * promise. Marks `chr:query-engine-compiled` on the page's performance timeline (criterion 10's
 * test hook).
 */
export function loadQueryEngine(load: QueryEngineLoader): Promise<void> {
  lastLoader = load;
  loading ??= load()
    .then(async (module) => {
      const compiled = await module.createEngine();
      lodashSource = module.lodashSource;
      engine = compiled;
      restarting = false;
      globalThis.performance?.mark?.('chr:query-engine-compiled');
    })
    .catch((error: unknown) => {
      loading = undefined;
      restarting = false;
      throw error;
    });
  return loading;
}

export const isQueryEngineLoaded = (): boolean => engine !== undefined;

/** The library's own Lodash check, run before anything else (lodashQueryLanguage.executeQuery). */
function checkLodashChain(query: string): void {
  const chains = query.match(/_\.chain\(/g)?.length;
  const values = query.match(/\.value\(\)/g)?.length;
  if (chains !== values) throw new QueryError(CHAIN_MESSAGE);
}

/**
 * Runs `queryText` (a script defining `function query (data)`) on a copy of `data` in a fresh
 * engine and returns the result as page data (Q1–Q4), or throws `QueryError`. The query text is
 * evaluated before the data is moved in, so a query that doesn't parse costs no copy (011 T1
 * REPORT §4).
 */
export function runQuery(language: QueryLanguageId, data: unknown, queryText: string): unknown {
  if (!engine) throw new QueryError(restarting ? RESTARTING_MESSAGE : NOT_LOADED_MESSAGE);
  if (language === 'lodash') checkLodashChain(queryText);

  const deadline = Date.now() + TIME_LIMIT_MS;
  let interrupted = false;
  const runtime = engine.newRuntime({
    memoryLimitBytes: MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: MAX_STACK_BYTES,
    interruptHandler: () => {
      if (Date.now() < deadline) return false;
      interrupted = true;
      return true;
    },
  });
  const handles: QuickJSHandle[] = [];
  let context: QuickJSContext | undefined;
  /** The page's side failed inside the engine (its stack overflowed, say): the module may be broken. */
  let hostFailed = false;
  try {
    const ctx = (context = runtime.newContext());
    const keep = (handle: QuickJSHandle): QuickJSHandle => {
      handles.push(handle);
      return handle;
    };
    const unwrap = (result: ReturnType<QuickJSContext['evalCode']>): QuickJSHandle => {
      if (result.error) {
        keep(result.error);
        throw engineError(ctx, result.error, interrupted);
      }
      return keep(result.value);
    };

    const helpers = unwrap(ctx.evalCode(ENGINE_HELPERS, 'chr-bridge.js'));
    const input = keep(ctx.getProp(helpers, 'input'));
    const output = keep(ctx.getProp(helpers, 'output'));
    if (language === 'lodash') unwrap(ctx.evalCode(lodashSource, 'lodash.min.js'));
    const query = unwrap(ctx.evalCode(wrapQuery(queryText), 'query.js'));

    let encoded: ReturnType<typeof encodeData>;
    try {
      encoded = encodeData(data);
    } catch (error) {
      // The page's own stack ran out walking the data (about 1000+ levels; spec 011 needs 64).
      if (error instanceof RangeError) throw new QueryError(DEPTH_MESSAGE, String(error));
      throw new QueryError(`The data can't be passed to the query: ${String(error)}`);
    }
    const dataHandle = unwrap(
      ctx.callFunction(
        input,
        ctx.undefined,
        keep(ctx.newString(encoded.text)),
        keep(ctx.newString(encoded.specials)),
      ),
    );
    const result = unwrap(ctx.callFunction(query, ctx.undefined, dataHandle));
    const written = unwrap(ctx.callFunction(output, ctx.undefined, result));
    const text = ctx.getString(keep(ctx.getProp(written, 0)));
    const specials = ctx.getString(keep(ctx.getProp(written, 1)));
    return decodeResult(text, specials);
  } catch (error) {
    if (error instanceof QueryError) throw error;
    // The engine failed outside JavaScript: out of memory in its own code, or the page's stack.
    hostFailed = true;
    const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new QueryError(limitMessage(raw, interrupted) ?? raw, raw);
  } finally {
    try {
      for (const handle of handles) if (handle.alive) handle.dispose();
      context?.dispose();
      runtime.dispose();
    } catch {
      hostFailed = true;
    }
    // A module that failed this way may hold broken state, so the next run gets a fresh one. Until
    // it is compiled, runQuery says the engine is restarting (the dialog's preview shows it, and
    // the next edit of the query or Transform runs again).
    if (hostFailed) {
      engine = undefined;
      loading = undefined;
      if (lastLoader) {
        restarting = true;
        loadQueryEngine(lastLoader).catch(() => {});
      }
    }
  }
}

/** The spec's message for a run stopped by a limit, if it was, or the plain stack message. */
function limitMessage(raw: string, interrupted: boolean): string | undefined {
  if (interrupted) return TIME_MESSAGE;
  if (/^(InternalError: )?out of memory$/i.test(raw)) return MEMORY_MESSAGE;
  if (/^(InternalError: )?stack overflow$|^RangeError: Maximum call stack/i.test(raw)) {
    return STACK_MESSAGE;
  }
  return undefined;
}

/** Maps a value the engine threw to a QueryError with the spec's messages (criteria 5, 6; Q2). */
function engineError(ctx: QuickJSContext, error: QuickJSHandle, interrupted: boolean): QueryError {
  let raw: string;
  try {
    const dumped: unknown = ctx.dump(error);
    if (dumped !== null && typeof dumped === 'object' && 'message' in dumped) {
      const { name, message } = dumped as { name?: unknown; message: unknown };
      const prefix = typeof name === 'string' && name !== 'Error' ? `${name}: ` : '';
      raw = prefix + String(message);
    } else {
      raw = typeof dumped === 'string' ? dumped : String(JSON.stringify(dumped));
    }
  } catch (dumpError) {
    raw = `The query failed, and its error can't be read: ${String(dumpError)}`;
  }
  if (raw === CYCLE_SENTINEL) return new QueryError(CYCLE_MESSAGE);
  const limit = limitMessage(raw, interrupted);
  return limit ? new QueryError(limit, raw) : new QueryError(raw);
}
