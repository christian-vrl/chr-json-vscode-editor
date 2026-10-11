// The types of ./compare.ts, in plain TypeScript so hosts that bundle the library build (dist/lib,
// vite.lib.config.mts) can type-check against them without compiling Svelte (./compare-ui.d.ts).
import type { CompareHostAdapter } from './compare-host-adapter.js';
import type { Disposable } from './host-adapter.js';
import type { Format } from './protocol.js';

export type MountCompare = (target: HTMLElement, host: CompareHostAdapter) => Disposable;

/** A side's data from its text; throws a `SyntaxError` when the text does not parse. */
export type ParseCompareText = (text: string, format: Format) => unknown;
