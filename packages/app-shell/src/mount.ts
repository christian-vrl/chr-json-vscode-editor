// The type of `mountApp` (./app.ts), in plain TypeScript so hosts that bundle the library build
// (dist/lib, vite.lib.config.mts) can type-check against it without compiling Svelte (./ui.d.ts).
import type { Disposable, HostAdapter } from './host-adapter.js';
import type { JsonPatchOperation } from './protocol.js';
import type { QueryEngineLoader } from './query/run-query.js';

export type { QueryEngineLoader, QueryEngineModule } from './query/run-query.js';

/** The mounted editor UI. */
export interface AppHandle extends Disposable {
  /** Sends operations as a tree or table edit would: the editor shows them at once, where it can,
   *  and follows the host's answer (e2e test hooks). */
  patch(operations: JsonPatchOperation[]): void;
  /** What the editor library holds now: `{ text }` or `{ json }`, undefined before it mounts. */
  content(): { text: string } | { json: unknown } | undefined;
  /** Every change was answered and the editor shows the document (e2e test hooks, benchmark). */
  settled(): boolean;
}

/** What a host adds to the editor beyond its HostAdapter. */
export interface MountOptions {
  /**
   * Loads the JavaScript and Lodash query engine (spec 011): `() => import(…)` of
   * src/query/engine.ts's build (dist/lib/engine.js). With it, Transform lists JavaScript and
   * Lodash and loads the engine when the dialog first opens (criterion 10); without it they are
   * not listed. The page's CSP must allow `'wasm-unsafe-eval'` (criterion 9).
   */
  loadQueryEngine?: QueryEngineLoader;
}

export type MountApp = (
  target: HTMLElement,
  host: HostAdapter,
  options?: MountOptions,
) => AppHandle;
