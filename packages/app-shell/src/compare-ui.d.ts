// Types of the compare library build (`@chr-json-editor/app-shell/compare`, dist/lib/compare.js from
// src/compare.ts). compare.ts declares both exports with the same types, so svelte-check keeps the
// two in step.
import type { MountCompare, ParseCompareText } from './compare-mount.js';

export type { MountCompare, ParseCompareText } from './compare-mount.js';

export declare const mountCompare: MountCompare;
export declare const parseCompareText: ParseCompareText;
export type * from './compare-host-adapter.js';
export type * from './host-adapter.js';
