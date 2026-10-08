import type { PatchOp } from '../engine.ts';

export interface Option {
  id: string;
  name: string;
  /** npm packages this option would add to the shipped bundle (its transitive tree is counted by run.ts). */
  packages: string[];
  /** How the option edits: through the shared engine, or the package's own writer. */
  via: string;
  apply(text: string, ops: PatchOp[]): string;
  /** Parse only; throws on input the option rejects. Used by the json5-tests conformance run. */
  parse?: (text: string) => unknown;
}
