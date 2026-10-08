// Messages of spike 004 T1. Host = extension host, page = the editor webview, frame = the
// sandboxed child frame (option A).
import type { ErrorKey } from './ajv-runner';

export const VARIANTS = [
  // Control: Ajv in the editor webview itself, under the unchanged 003 T4 CSP.
  'main-frame',
  // Option A: a child frame loaded from the extension's dist folder.
  'iframe-src-unchanged-csp', // the 003 T4 CSP as is (no frame-src)
  'iframe-src', // the 003 T4 CSP plus `frame-src <webview.cspSource>`
  'iframe-src-unsandboxed', // the same without the iframe `sandbox` attribute
  // Option A alternatives that need no file: both inherit the parent's CSP per CSP3 (recorded).
  'iframe-srcdoc', // the 003 T4 CSP as is
  'iframe-blob', // the 003 T4 CSP plus `frame-src blob:` (outside criterion 6's allowed sources)
  // Option B: Ajv in the extension host, errors sent to the webview.
  'host',
] as const;
export type Variant = (typeof VARIANTS)[number];

export const RUNS = 5;

/** host → page after the page says it loaded. */
export interface StartMessage {
  type: 'start';
  variant: Variant;
  text: string;
  schema: object;
  sandboxUrl: string;
}

/** page or frame → host/page. */
export interface Measurement {
  /** null when it could not run; `error` says why. */
  compileMs: number | null;
  /** Per run: time from "validate this text" to errors in the page (parse + transfer + validate). */
  totalMs: number[];
  /** Per run: Ajv's validate() call alone. */
  validateMs: number[];
  errors: ErrorKey[] | null;
  error?: string;
  /** Time from creating the child frame to its first message (option A). */
  frameLoadMs?: number;
  /** srcdoc and blob: frames only: what an inline eval probe in the frame reported. */
  frameProbe?: { evalAllowed: boolean; evalError?: string };
}

export interface CspViolation {
  violatedDirective: string;
  blockedURI: string;
  sourceFile: string;
}

export interface ResultMessage extends Measurement {
  type: 'result';
  variant: Variant;
  policy: string;
  violations: CspViolation[];
  userAgent: string;
}

/** frame ↔ page. */
export type FrameRequest =
  { type: 'compile'; schema: object } | { type: 'validate'; data: unknown };
export type FrameReply =
  | { type: 'frameReady'; evalAllowed: boolean; evalError?: string }
  | { type: 'probe'; evalAllowed: boolean; evalError?: string }
  | { type: 'compiled'; compileMs: number | null; error?: string }
  | { type: 'validated'; errors: ErrorKey[]; validateMs: number }
  | { type: 'failed'; error: string };
