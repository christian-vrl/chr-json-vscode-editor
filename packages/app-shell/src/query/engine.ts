// The query engine's heavy half (spec 011 criterion 10, plan R7): QuickJS's WebAssembly (base64
// inside the single-file browser variant) and Lodash's source, which only the engine evaluates.
// Nothing imports this module statically: each host loads it with `import()` when the Transform
// dialog first opens (the standalone page as a Vite chunk, the VS Code webview by its webview URI,
// 011 T1 REPORT §3 route (a)) and hands it to `loadQueryEngine`. The library build emits it as
// dist/lib/engine.js (vite.lib.config.mts).
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import lodashSource from 'lodash/lodash.min.js?raw';
import type { QueryEngineModule } from './run-query.js';

/** Compiles the engine's WebAssembly. */
export const createEngine: QueryEngineModule['createEngine'] = () =>
  newQuickJSWASMModuleFromVariant(variant);

export { lodashSource };
