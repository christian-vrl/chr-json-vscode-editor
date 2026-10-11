// The type of ./csv.ts, in plain TypeScript so hosts that bundle the library build (dist/lib,
// vite.lib.config.mts) can type-check against it without compiling Svelte (./csv-ui.d.ts).
import type { CsvHostAdapter } from './csv-host-adapter.js';
import type { Disposable } from './host-adapter.js';

export type MountCsv = (target: HTMLElement, host: CsvHostAdapter) => Disposable;
