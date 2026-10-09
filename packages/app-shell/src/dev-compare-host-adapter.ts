// CompareHostAdapter for the standalone compare page (007 T3): holds both documents' text in
// memory and does what the extension host does with them (plan 007 §Approach), with core: parses
// each side in its own format, runs `compare`, and applies a copy as `copyDifference` through the
// format's style-preserving `applyPatch`. `setText` plays an edit made in another editor
// (criterion 7). Like DevHostAdapter, it delivers every update asynchronously, as postMessage does.
import { compare, copyDifference, getAdapter } from '@chr-json-editor/core';
import type {
  CompareHostAdapter,
  CompareNotice,
  CompareSide,
  CompareSideState,
  CompareState,
  Difference,
} from './compare-host-adapter.js';
import type { Disposable } from './host-adapter.js';
import { parserFor } from './parser.js';
import type { Format } from './protocol.js';

/** One side as the dev host holds it. */
export interface DevCompareDocument {
  name: string;
  text: string;
  format: Format;
  /** Whether copies into this side are offered; true by default. */
  writable?: boolean;
}

/** One copy the page asked for, as received. */
export interface DevCopy {
  version: number;
  difference: Difference;
  to: CompareSide;
}

export class DevCompareHostAdapter implements CompareHostAdapter {
  readonly #docs: Record<CompareSide, Required<DevCompareDocument>>;
  #version = 1;
  #state: CompareState;
  readonly #listeners = new Set<(state: CompareState) => void>();
  /** Every copy `copy` received, applied or not, oldest first. */
  readonly copies: DevCopy[] = [];
  /** Every notice `showMessage` received, and every copy the host refused, oldest first. */
  readonly notices: CompareNotice[] = [];

  constructor(left: DevCompareDocument, right: DevCompareDocument) {
    this.#docs = {
      left: { writable: true, ...left },
      right: { writable: true, ...right },
    };
    this.#state = this.#compute();
  }

  /** A side's text as the host holds it now. */
  text(side: CompareSide): string {
    return this.#docs[side].text;
  }

  get state(): CompareState {
    return structuredClone(this.#state);
  }

  open(): Promise<CompareState> {
    return Promise.resolve(this.state);
  }

  onUpdate(listener: (state: CompareState) => void): Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  copy(version: number, difference: Difference, to: CompareSide): void {
    this.copies.push({ version, difference: structuredClone(difference), to });
    const from: CompareSide = to === 'left' ? 'right' : 'left';
    const target = this.#docs[to];
    const source = this.#state[from].content;
    const current = this.#state[to].content;
    if (version !== this.#version) {
      this.#refuse('stale-copy', `Copy made on version ${version}, compare is at ${this.#version}`);
      return;
    }
    if (!target.writable) {
      this.#refuse('read-only', `${target.name} cannot be changed here`);
      return;
    }
    if (source.kind !== 'data' || current.kind !== 'data') {
      this.#refuse('not-compared', 'Both sides must parse to copy a difference');
      return;
    }
    try {
      const patch = copyDifference(source.data, current.data, difference, from);
      this.setText(to, getAdapter(target.format).applyPatch(target.text, patch));
    } catch (e) {
      this.#refuse('copy-failed', e instanceof Error ? e.message : String(e));
    }
  }

  showMessage(notice: CompareNotice): void {
    this.notices.push(structuredClone(notice));
  }

  /** Plays an edit to one side made anywhere (another editor, a copy): compares again and updates. */
  setText(side: CompareSide, text: string): void {
    this.#docs[side].text = text;
    this.#version += 1;
    this.#state = this.#compute();
    const state = this.#state;
    for (const listener of [...this.#listeners]) {
      const copy = structuredClone(state);
      queueMicrotask(() => {
        if (this.#listeners.has(listener)) listener(copy);
      });
    }
  }

  #refuse(code: string, message: string): void {
    this.notices.push({ code, message });
  }

  #compute(): CompareState {
    const left = sideState(this.#docs.left);
    const right = sideState(this.#docs.right);
    const differences =
      left.content.kind === 'data' && right.content.kind === 'data'
        ? compare(left.content.data, right.content.data)
        : [];
    return { version: this.#version, left, right, differences };
  }
}

/** Parses a side with the same parser the editor uses (parser.ts): an error diagnostic fails it. */
function sideState(doc: Required<DevCompareDocument>): CompareSideState {
  let content: CompareSideState['content'];
  try {
    content = { kind: 'data', data: parserFor(doc.format).parse(doc.text) };
  } catch (e) {
    content = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  return { name: doc.name, format: doc.format, content, writable: doc.writable };
}
