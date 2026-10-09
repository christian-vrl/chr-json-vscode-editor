// Host-agnostic editor UI (spec 003). This entry is plain TypeScript: the HostAdapter seam, the
// versioned message protocol (003 T1) and the standalone page's DevHostAdapter (003 T2). The Svelte
// UI is mounted with `mountApp` from ./app.ts, which each host's page bundles. The compare page
// (007 T3) has its own seam, CompareHostAdapter, and dev host, mounted with `mountCompare` (./compare.ts).
export const packageName = '@chr-json-editor/app-shell';
export type * from './host-adapter.js';
export * from './protocol.js';
export { DevHostAdapter, type DevDocument, type DevEdit } from './dev-host-adapter.js';
export { TEXT_DEBOUNCE_MS } from './text-mode.js';
export type * from './compare-host-adapter.js';
export {
  DevCompareHostAdapter,
  type DevCompareDocument,
  type DevCopy,
} from './dev-compare-host-adapter.js';
