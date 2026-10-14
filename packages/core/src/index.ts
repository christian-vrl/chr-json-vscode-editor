// Pure TypeScript core: no DOM, no Node APIs (AGENTS.md §Critical paths).
export const packageName = '@chr-json-editor/core';
export * from './formats/index.js';
export * from './schema/index.js';
export { diff } from './diff.js';
export { compare, copyDifference, type CompareSide, type Difference } from './compare.js';
export { repair, type RepairResult } from './repair/repair.js';
export { repairLines, type RepairLinesResult } from './repair/lines.js';
export { detect, strictJsonDiagnostics } from './detect.js';
export type { Detection, DetectionSource, StrictJsonDiagnostic } from './detect.js';
export * from './csv/index.js';
export { importData, IMPORT_OUTPUT_STYLE } from './import/index.js';
export type { ImportError, ImportKind, ImportResult, ImportWarning } from './import/index.js';
