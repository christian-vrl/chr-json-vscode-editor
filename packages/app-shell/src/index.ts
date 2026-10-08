// Host-agnostic editor UI (spec 003). The UI lands in 003 T2; T1 adds the HostAdapter seam and
// the versioned message protocol it is built on.
export const packageName = '@chr-json-editor/app-shell';
export type * from './host-adapter.js';
export * from './protocol.js';
