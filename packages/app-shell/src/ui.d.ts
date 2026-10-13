// Types of the library build (`@chr-json-editor/app-shell/ui`, dist/lib/app.js from src/app.ts).
// app.ts declares `mountApp` with the same `MountApp` type, so svelte-check keeps the two in step.
import type { MountApp } from './mount.js';

export type { AppHandle, MountOptions, QueryEngineLoader, QueryEngineModule } from './mount.js';

export declare const mountApp: MountApp;
export type * from './host-adapter.js';
