// The type of `mountApp` (./app.ts), in plain TypeScript so hosts that bundle the library build
// (dist/lib, vite.lib.config.mts) can type-check against it without compiling Svelte (./ui.d.ts).
import type { Disposable, HostAdapter } from './host-adapter.js';

export type MountApp = (target: HTMLElement, host: HostAdapter) => Disposable;
