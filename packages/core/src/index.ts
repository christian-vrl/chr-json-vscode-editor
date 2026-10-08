// Pure TypeScript core: no DOM, no Node APIs (AGENTS.md §Critical paths).
export const packageName = '@chr-json-editor/core';
export * from './formats/index.js';
export * from './schema/index.js';
export { diff } from './diff.js';
export { detect, strictJsonDiagnostics } from './detect.js';
export type { Detection, DetectionSource, StrictJsonDiagnostic } from './detect.js';
