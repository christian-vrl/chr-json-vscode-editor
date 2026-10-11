// Spike 011 T1, plan R7 routes (a) and (b): a page without the engine that loads it from a second
// file, as a lazy engine chunk would. (a) is a dynamic import() of an ES module from the page's
// nonce'd classic script; (b) adds a second <script> carrying the page's nonce.
import type { Engine } from './engine';
import type { LoadResult, Route } from './protocol';
import { describe, onStart, pageInfo, pageNonce, settle, vscode } from './pageCommon';

type EngineModule = { loadEngine(): Promise<Engine> };

function loadByImport(url: string): Promise<EngineModule> {
  return import(/* @vite-ignore */ url) as Promise<EngineModule>;
}

function loadByScript(url: string): Promise<EngineModule> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.nonce = pageNonce;
    script.src = url;
    script.onload = () => {
      const engine = (globalThis as { chrQueryEngine?: EngineModule }).chrQueryEngine;
      if (engine) resolve(engine);
      else reject(new Error('the script loaded but set no chrQueryEngine'));
    };
    script.onerror = () => reject(new Error('the script did not load'));
    document.head.append(script);
  });
}

onStart(async (start) => {
  if (start.task.kind !== 'load') throw new Error(`loader page got ${start.task.kind}`);
  const route: Route = start.task.route;
  const t0 = performance.now();
  const result: LoadResult = {
    type: 'loadResult',
    route,
    loaded: false,
    error: null,
    loadMs: 0,
    check: null,
    info: pageInfo(),
  };
  try {
    const module =
      route === 'a'
        ? await loadByImport(start.engineModuleUrl)
        : await loadByScript(start.engineClassicUrl);
    const engine = await module.loadEngine();
    result.loadMs = performance.now() - t0;
    result.check = engine.runQuery(
      'javascript',
      JSON.parse(start.text),
      'function query (data) { return data.length }',
    );
    result.loaded = true;
  } catch (error) {
    result.loadMs = performance.now() - t0;
    result.error = describe(error);
  }
  await settle();
  result.info = pageInfo();
  vscode.postMessage(result);
});
