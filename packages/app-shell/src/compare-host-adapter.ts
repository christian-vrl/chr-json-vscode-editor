// The seam between the compare page (Compare.svelte, spec 007 criterion 3) and the host it runs in
// (ADR-002, plan 007 §Approach). The single-document HostAdapter has no notion of two documents, so
// the compare page gets its own. All computation stays in the host: it parses both sides with core,
// runs `compare`, and sends the data and the differences; the page only shows them and asks for a
// copy, which the host applies to the target document (ADR-003; in VS Code a `WorkspaceEdit` made
// with `applyPatch`, 007 T4). Implemented by DevCompareHostAdapter for the standalone page and
// `pnpm test:web`, and by the extension's compare panel (007 T4).
import type { CompareSide, Difference } from '@chr-json-editor/core';
import type { Disposable } from './host-adapter.js';
import type { Format } from './protocol.js';

export type { CompareSide, Difference };

/** One side of the compare as the host parsed it. */
export interface CompareSideState {
  /** The title above the panel: the file name, or `<name> (HEAD)` (spec 007 criterion 4). */
  name: string;
  /** The side's own detected format (criterion 8). */
  format: Format;
  /** The side's data, or why it has none: a parse error is shown instead of a tree (criterion 8). */
  content: { kind: 'data'; data: unknown } | { kind: 'error'; message: string };
  /** Whether the page offers a copy into this side; the HEAD side takes none (criterion 6). */
  writable: boolean;
}

/** Everything the page shows, as of `version`. */
export interface CompareState {
  /** Grows with every change to either side, so a copy made on an older state can be refused. */
  version: number;
  left: CompareSideState;
  right: CompareSideState;
  /** `compare(left, right)` in order; empty when either side does not parse (nothing is compared). */
  differences: Difference[];
}

/** A failure the page asks the host to show. */
export interface CompareNotice {
  code: string;
  message: string;
}

export interface CompareHostAdapter {
  /** Resolves once with both sides and their differences. */
  open(): Promise<CompareState>;
  /** Subscribes to every later state: a side was edited anywhere (criterion 7), or a copy applied. */
  onUpdate(listener: (state: CompareState) => void): Disposable;
  /**
   * Asks the host to copy `difference` (from the state at `version`) from the other side into
   * side `to`, with core's `copyDifference`. The result comes back as an update; the host refuses
   * a copy into a side that is not writable or made on a state that is no longer current.
   */
  copy(version: number, difference: Difference, to: CompareSide): void;
  /** Asks the host to show a failure to the user. */
  showMessage(notice: CompareNotice): void;
}
