// The type of `mountApp` (./app.ts), in plain TypeScript so hosts that bundle the library build
// (dist/lib, vite.lib.config.mts) can type-check against it without compiling Svelte (./ui.d.ts).
import type { Disposable, HostAdapter } from './host-adapter.js';
import type { JsonPatchOperation } from './protocol.js';

/** The mounted editor UI. */
export interface AppHandle extends Disposable {
  /** Sends operations as a tree or table edit would, and the view follows (e2e test hooks). */
  patch(operations: JsonPatchOperation[]): void;
  /** What the editor library holds now: `{ text }` or `{ json }`, undefined before it mounts. */
  content(): { text: string } | { json: unknown } | undefined;
}

export type MountApp = (target: HTMLElement, host: HostAdapter) => AppHandle;
