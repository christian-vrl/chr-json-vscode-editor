// Types of the CSV library build (`@chr-json-editor/app-shell/csv`, dist/lib/csv.js from
// src/csv.ts). csv.ts declares `mountCsv` with the same type, so svelte-check keeps the two in step.
import type { MountCsv } from './csv-mount.js';

export type { MountCsv } from './csv-mount.js';

export declare const mountCsv: MountCsv;
export type * from './csv-host-adapter.js';
export type * from './host-adapter.js';
