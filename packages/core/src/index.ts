// Pure TypeScript core: no DOM, no Node APIs (AGENTS.md §Critical paths).
export const packageName = '@chr-json-editor/core';
export * from './formats/index.js';
export * from './schema/index.js';
export { diff } from './diff.js';
export { compare, copyDifference, type CompareSide, type Difference } from './compare.js';
export { repair, type RepairResult } from './repair/repair.js';
export { detect, strictJsonDiagnostics } from './detect.js';
export type { Detection, DetectionSource, StrictJsonDiagnostic } from './detect.js';
export * from './csv/index.js';
