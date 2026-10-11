// Messages between the spike's webview pages and its extension host side (dev-only).
import type { Language, RunTimings } from './engine';

/** Which policy the page gets: 003 criterion 6's plus `'wasm-unsafe-eval'` (spec 011 criterion 9),
 *  or 003's unchanged, to show the source is needed. */
export type Policy = 'wasm' | 'unchanged';

/** R7's routes: (a) a dynamic import(), (b) a second nonce'd script added by the page, (c) the
 *  engine inside the main bundle. */
export type Route = 'a' | 'b' | 'c';

export type Task =
  | { kind: 'load'; route: Route }
  | { kind: 'probes' }
  | { kind: 'bench'; runs: number }
  | { kind: 'typing'; runs: { language: Language; intervalMs: number }[] };

export interface StartMessage {
  type: 'start';
  task: Task;
  text: string;
  engineModuleUrl: string;
  engineClassicUrl: string;
}

export interface Violation {
  directive: string;
  blockedURI: string;
  sample: string;
}

export interface PageInfo {
  policy: string;
  userAgent: string;
  violations: Violation[];
}

export interface LoadResult {
  type: 'loadResult';
  route: Route;
  loaded: boolean;
  error: string | null;
  /** From the start of loading to a compiled engine. */
  loadMs: number;
  /** A trivial query on the document, as a check that the engine runs. */
  check: unknown;
  info: PageInfo;
}

export interface ProbeResult {
  type: 'probeResult';
  id: string;
  ms: number;
  value?: unknown;
  error?: string;
  engineError?: string;
  /** The trivial query that runs right after (criterion 5: "the next query runs"). */
  next: unknown;
  info: PageInfo;
}

export interface BenchResult {
  type: 'benchResult';
  id: string;
  language: string;
  runs: RunTimings[];
  resultHash: string;
  resultLength: number;
}

export interface TypingResult {
  type: 'typingResult';
  language: Language;
  intervalMs: number;
  /** Characters typed one at a time. */
  typed: string;
  /** performance.now() of each key's handling, relative to the first key. */
  keyAt: number[];
  /** Each preview run that started after the first key: start (relative) and length. */
  runs: { at: number; ms: number; queryLength: number }[];
  longestKeyGapMs: number;
  /** The last preview run's query is the final text. */
  finalPreviewMatches: boolean;
  previewText: string;
}
