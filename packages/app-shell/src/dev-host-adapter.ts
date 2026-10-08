// HostAdapter for the standalone page (003 T2): keeps the document in memory, so app-shell runs in
// a plain browser tab with no host behind it (`pnpm test:web`, local development). It speaks the
// same contract as VscodeHostAdapter (test/host-adapter-contract.ts) and adds a few methods that
// play the host's part: an external change, a mode or format switch.
//
// Dev-only limitation: a patch is applied to `JSON.parse(text)` and the result re-serialised with
// two-space indentation, so comments and style are not kept. Style-preserving edits are
// `core.applyPatch` in the extension host (plan 003 §Constraints, task T5), never here.
import { immutableJSONPatch } from 'immutable-json-patch';
import type {
  Disposable,
  HostAdapter,
  HostEvent,
  HostNotice,
  OpenedDocument,
} from './host-adapter.js';
import {
  PROTOCOL_VERSION,
  type DocumentChange,
  type EditErrorCode,
  type EditorSettings,
  type Format,
  type JsonPatchOperation,
  type Mode,
  type UpdateOrigin,
} from './protocol.js';

/** One change the UI handed over through `save`, as received. */
export interface DevEdit {
  docVersion: number;
  change: DocumentChange;
}

export interface DevDocument {
  text: string;
  format: Format;
  mode: Mode;
  settings?: EditorSettings;
}

export class DevHostAdapter implements HostAdapter {
  #text: string;
  #format: Format;
  readonly #mode: Mode;
  readonly #settings: EditorSettings;
  #docVersion = 1;
  #opened = false;
  readonly #listeners = new Set<(event: HostEvent) => void>();
  /** Every change `save` received, accepted or not, oldest first. */
  readonly edits: DevEdit[] = [];
  /** Every notice `showMessage` received, oldest first. */
  readonly notices: HostNotice[] = [];

  constructor(document: DevDocument) {
    this.#text = document.text;
    this.#format = document.format;
    this.#mode = document.mode;
    this.#settings = document.settings ?? {};
  }

  /** The document text as the host holds it now. */
  get text(): string {
    return this.#text;
  }

  get docVersion(): number {
    return this.#docVersion;
  }

  open(): Promise<OpenedDocument> {
    this.#opened = true;
    return Promise.resolve({
      docVersion: this.#docVersion,
      text: this.#text,
      format: this.#format,
      mode: this.#mode,
      settings: this.#settings,
    });
  }

  save(docVersion: number, change: DocumentChange): void {
    this.edits.push({ docVersion, change: structuredClone(change) });
    if (docVersion !== this.#docVersion) {
      this.#emitError(
        'stale-edit',
        `Edit made on version ${docVersion}, document is at ${this.#docVersion}`,
      );
      return;
    }
    let text: string;
    try {
      text = change.kind === 'text' ? change.text : applyJsonPatch(this.#text, change.patch);
    } catch (e) {
      this.#emitError('patch-failed', e instanceof Error ? e.message : String(e));
      return;
    }
    this.#setText(text, 'edit');
  }

  onExternalChange(listener: (event: HostEvent) => void): Disposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  getSettings(): EditorSettings {
    if (!this.#opened) throw new Error('DevHostAdapter: getSettings() before open()');
    return this.#settings;
  }

  showMessage(notice: HostNotice): void {
    this.notices.push(structuredClone(notice));
  }

  /** Plays another editor changing the document: bumps the version and sends `update`. */
  externalChange(text: string): void {
    this.#setText(text, 'external');
  }

  /** Plays the host asking the UI to switch mode (`setMode`). */
  setMode(mode: Mode): void {
    this.#emit({ protocol: PROTOCOL_VERSION, type: 'setMode', docVersion: this.#docVersion, mode });
  }

  /** Plays the host re-parsing the document as another format (`setFormat`); bytes are unchanged. */
  setFormat(format: Format): void {
    this.#format = format;
    this.#emit({
      protocol: PROTOCOL_VERSION,
      type: 'setFormat',
      docVersion: this.#docVersion,
      format,
    });
  }

  #setText(text: string, origin: UpdateOrigin): void {
    this.#text = text;
    this.#docVersion += 1;
    this.#emit({
      protocol: PROTOCOL_VERSION,
      type: 'update',
      docVersion: this.#docVersion,
      text,
      origin,
    });
  }

  #emitError(code: EditErrorCode, message: string): void {
    this.#emit({
      protocol: PROTOCOL_VERSION,
      type: 'error',
      docVersion: this.#docVersion,
      code,
      message,
    });
  }

  #emit(event: HostEvent): void {
    // Like postMessage, each listener gets its own copy and delivery is never synchronous with the
    // call that caused it, so the UI cannot depend on an ordering VS Code would not give it.
    for (const listener of [...this.#listeners]) {
      const copy = structuredClone(event);
      queueMicrotask(() => {
        if (this.#listeners.has(listener)) listener(copy);
      });
    }
  }
}

function applyJsonPatch(text: string, patch: JsonPatchOperation[]): string {
  const data: unknown = JSON.parse(text);
  const patched = immutableJSONPatch<unknown>(data, patch);
  return JSON.stringify(patched, null, 2) + '\n';
}
