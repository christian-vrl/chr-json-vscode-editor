// Copy path and reveal node (spec 018): path text (P1–P4) and locating (A1–A6, R1–R3).
export { jsonPath, jsonPointer, readPath } from './text.js';
export type { Path, PathStep, ReadPathResult } from './text.js';
export { nodeAt, placeOf } from './locate.js';
export type { NodeAtResult, PathError } from './locate.js';
export { badItems, tablePath, textPath } from './lines.js';
