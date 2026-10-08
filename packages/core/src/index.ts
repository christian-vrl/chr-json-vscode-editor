// Public API of core. Formats, diff and CSV land with the rest of spec 002 and later specs.
export const packageName = '@chr-json-editor/core';

export { detect, strictJsonDiagnostics } from './detect.js';
export type { Detection, DetectionSource, Diagnostic, Format } from './detect.js';
