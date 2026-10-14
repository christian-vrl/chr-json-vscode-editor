// HostAdapter for the standalone page (003 T2): keeps the document in memory, so app-shell runs in
// a plain browser tab with no host behind it (`pnpm test:web`, local development). It speaks the
// same contract as VscodeHostAdapter (test/host-adapter-contract.ts) and adds a few methods that
// play the host's part: an external change, a mode or format switch, a validation result, a save's
// `flush`. It runs no validator itself (ADR-010: validation belongs to the host). Its undo history
// holds every text change, the UI's and external ones, like VS Code's history of a document.
//
// Dev-only limitation: a patch is applied to `JSON.parse(text)` and the result re-serialised with
// two-space indentation, so comments and style are not kept. Style-preserving edits are
// `core.applyPatch` in the extension host (plan 003 §Constraints, task T5), never here. Whole-document
// actions (003 T8) run core's own action on the text, as the extension host does, so the page
// shows what they do; a repair that would lose comments is applied without asking.
//
// Settings (spec 019) are an option of the document, every one left out at its default, and
// `setSettings` plays the user changing one, as the extension host sends it to an open tab (A2).
//
// Large-file mode (spec 008) is a switch here (`largeFile`), as the extension host decides it by
// the document's size: a locked document answers every change with a `read-only` error and ignores
// undo and redo, as the extension host does; "Edit anyway" unlocks it. "Open as Text" is recorded
// only, since the page has no other editor to open.
//
// A JSON Lines document (spec 012) takes patches through core's `jsonl` adapter, which writes one
// line per item and refuses any patch while a bad line is left (L9), as the extension host does;
// "Repair Lines" runs core's `repairLines`.
//
// Copy path and reveal node (spec 018, 018 T2): the page's copy requests and "Reveal in Text Editor"
// are recorded (`copies`, `textReveals`), as the page has no clipboard or text editor of its own to
// hand them to; `requestNode` and `reveal` play the host's side of the copy and reveal commands.
import { getAdapter, repair, repairLines, smartFormat } from '@chr-json-editor/core';
import { immutableJSONPatch } from 'immutable-json-patch';
import type {
  Disposable,
  HostAdapter,
  HostEvent,
  HostNotice,
  OpenedDocument,
} from './host-adapter.js';
import {
  DEFAULT_EDITOR_SETTINGS,
  PROTOCOL_VERSION,
  type CurrentNode,
  type DocumentAction,
  type DocumentChange,
  type EditErrorCode,
  type EditorSettings,
  type Format,
  type JsonPatchOperation,
  type LargeFile,
  type Mode,
  type NodePath,
  type SchemaDialect,
  type UpdateOrigin,
  type ValidationMessage,
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
  /** The page's settings (spec 019); each one left out is at its default. */
  settings?: Partial<EditorSettings>;
  /** Opens the document in large-file mode (spec 008); the normal editor when left out. */
  largeFile?: LargeFile | null;
}

export class DevHostAdapter implements HostAdapter {
  #text: string;
  #format: Format;
  readonly #mode: Mode;
  #settings: EditorSettings;
  #largeFile: LargeFile | null;
  #docVersion = 1;
  #opened = false;
  /** Answers held back by `hold()`, sent by `release()`. */
  #held: (() => void)[] | undefined;
  readonly #listeners = new Set<(event: HostEvent) => void>();
  /** Every change `save` received, accepted or not, oldest first. */
  readonly edits: DevEdit[] = [];
  /** Every notice `showMessage` received, oldest first. */
  readonly notices: HostNotice[] = [];
  /** Every dialect `setSchemaDialect` received, oldest first. */
  readonly dialects: SchemaDialect[] = [];
  /** Every `undo` and `redo` received, oldest first. */
  readonly history: ('undo' | 'redo')[] = [];
  /** Every `openAsText` and `unlock` received, oldest first (spec 008's banner). */
  readonly banner: ('openAsText' | 'unlock')[] = [];
  /** Texts to go back to (`undo`) and forward to (`redo`), newest last. */
  readonly #undoStack: string[] = [];
  readonly #redoStack: string[] = [];
  /** `flush` requests sent and waiting for `flushed`, by request number. */
  readonly #flushing = new Map<number, () => void>();
  #nextFlush = 1;
  /** `getRowSource` requests sent and waiting for `rowSource`, by request number (009 T4). */
  readonly #rowSources = new Map<number, (path: string) => void>();
  /** `getNode` requests sent and waiting for `node`, by request number (018 T2). */
  readonly #nodes = new Map<number, (node: CurrentNode) => void>();
  /** Every text `copyText` received, oldest first (spec 018 S2, S3). */
  readonly copies: string[] = [];
  /** Every path `revealInText` received, oldest first (spec 018 S2). */
  readonly textReveals: NodePath[] = [];

  constructor(document: DevDocument) {
    this.#text = document.text;
    this.#format = document.format;
    this.#mode = document.mode;
    this.#settings = { ...DEFAULT_EDITOR_SETTINGS, ...document.settings };
    this.#largeFile = document.largeFile ?? null;
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
      settings: { ...this.#settings },
      largeFile: this.#largeFile && { ...this.#largeFile },
    });
  }

  /** The large-file state as the host holds it now (unlocked after `unlock`). */
  get largeFile(): LargeFile | null {
    return this.#largeFile && { ...this.#largeFile };
  }

  /** Whether the document is a locked large-file document, which takes no change (spec 008). */
  get #locked(): boolean {
    return this.#largeFile !== null && !this.#largeFile.unlocked;
  }

  save(docVersion: number, change: DocumentChange): void {
    this.edits.push({ docVersion, change: structuredClone(change) });
    if (this.#held) {
      this.#held.push(() => this.#answer(docVersion, change));
      return;
    }
    this.#answer(docVersion, change);
  }

  /** Plays a slow host: changes `save` receives from now on are answered only on `release()`. */
  hold(): void {
    this.#held ??= [];
  }

  /** Answers the held changes, in order, and answers at once again from now on. */
  release(): void {
    const held = this.#held ?? [];
    this.#held = undefined;
    for (const answer of held) answer();
  }

  #answer(docVersion: number, change: DocumentChange): void {
    if (this.#locked) {
      this.#emitError('read-only', 'This large file is read-only; choose "Edit anyway" to edit it');
      return;
    }
    if (docVersion !== this.#docVersion) {
      this.#emitError(
        'stale-edit',
        `Edit made on version ${docVersion}, document is at ${this.#docVersion}`,
      );
      return;
    }
    let text: string;
    try {
      if (change.kind === 'text') text = change.text;
      else if (change.kind === 'patch' && this.#format === 'jsonl')
        text = getAdapter('jsonl').applyPatch(this.#text, change.patch);
      else if (change.kind === 'patch') text = applyJsonPatch(this.#text, change.patch);
      else text = runAction(this.#text, this.#format, change.action);
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
    return { ...this.#settings };
  }

  /** Plays the user changing a setting (spec 019 A2): sends `settings` with every page setting,
   *  `changes` over the current ones. */
  setSettings(changes: Partial<EditorSettings>): void {
    this.#settings = { ...this.#settings, ...changes };
    this.#emit({
      protocol: PROTOCOL_VERSION,
      type: 'settings',
      docVersion: this.#docVersion,
      settings: { ...this.#settings },
    });
  }

  showMessage(notice: HostNotice): void {
    this.notices.push(structuredClone(notice));
  }

  setSchemaDialect(_docVersion: number, dialect: SchemaDialect): void {
    this.dialects.push(dialect);
  }

  undo(): void {
    this.history.push('undo');
    if (this.#locked) return;
    this.#step(this.#undoStack, this.#redoStack);
  }

  redo(): void {
    this.history.push('redo');
    if (this.#locked) return;
    this.#step(this.#redoStack, this.#undoStack);
  }

  /** Moves to the newest text of `from`, keeping the current one on `to`; none left does nothing. */
  #step(from: string[], to: string[]): void {
    const text = from.pop();
    if (text === undefined) return;
    to.push(this.#text);
    this.#text = text;
    this.#docVersion += 1;
    this.#emitUpdate('external');
  }

  flushed(_docVersion: number, request: number): void {
    this.#flushing.get(request)?.();
    this.#flushing.delete(request);
  }

  openAsText(): void {
    this.banner.push('openAsText');
  }

  rowSource(_docVersion: number, request: number, path: string): void {
    this.#rowSources.get(request)?.(path);
    this.#rowSources.delete(request);
  }

  /** Plays "Export to CSV…" (009 T4): sends `getRowSource` and resolves with the UI's answer. */
  requestRowSource(): Promise<string> {
    const request = this.#nextFlush++;
    return new Promise((resolve) => {
      this.#rowSources.set(request, resolve);
      this.#emit({
        protocol: PROTOCOL_VERSION,
        type: 'getRowSource',
        docVersion: this.#docVersion,
        request,
      });
    });
  }

  node(_docVersion: number, request: number, node: CurrentNode): void {
    this.#nodes.get(request)?.(structuredClone(node));
    this.#nodes.delete(request);
  }

  copyText(_docVersion: number, text: string): void {
    this.copies.push(text);
  }

  revealInText(_docVersion: number, path: NodePath): void {
    this.textReveals.push([...path]);
  }

  /** Plays a copy command (spec 018 S5): sends `getNode` and resolves with the UI's answer. */
  requestNode(): Promise<CurrentNode> {
    const request = this.#nextFlush++;
    return new Promise((resolve) => {
      this.#nodes.set(request, resolve);
      this.#emit({
        protocol: PROTOCOL_VERSION,
        type: 'getNode',
        docVersion: this.#docVersion,
        request,
      });
    });
  }

  /** Plays "Reveal in CHR JSON Editor" (spec 018 S5): sends `reveal` for `path`. */
  reveal(path: NodePath): void {
    this.#emit({ protocol: PROTOCOL_VERSION, type: 'reveal', docVersion: this.#docVersion, path });
  }

  unlock(): void {
    this.banner.push('unlock');
    if (this.#largeFile) this.#largeFile = { ...this.#largeFile, unlocked: true };
  }

  /** Plays the host before a save: sends `flush` and resolves once the UI answers `flushed`. */
  flush(): Promise<void> {
    const request = this.#nextFlush++;
    return new Promise((resolve) => {
      this.#flushing.set(request, resolve);
      this.#emit({
        protocol: PROTOCOL_VERSION,
        type: 'flush',
        docVersion: this.#docVersion,
        request,
      });
    });
  }

  /** Plays the host's validator: sends `validation` for the current version. */
  validation(dialect: ValidationMessage['dialect'], result: ValidationMessage['result']): void {
    this.#emit({
      protocol: PROTOCOL_VERSION,
      type: 'validation',
      docVersion: this.#docVersion,
      dialect,
      result,
    });
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
    this.#undoStack.push(this.#text);
    this.#redoStack.length = 0;
    this.#text = text;
    this.#docVersion += 1;
    this.#emitUpdate(origin);
  }

  #emitUpdate(origin: UpdateOrigin): void {
    const text = this.#text;
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

/** Core's whole-document action on the text, as the extension host runs it (003 T8). */
function runAction(text: string, format: Format, action: DocumentAction): string {
  const adapter = getAdapter(format);
  switch (action.name) {
    case 'format':
      return adapter.prettyPrint(text);
    case 'smartFormat':
      // Not for JSON Lines (spec 010 §Scope), as in the extension host.
      if (format === 'jsonl')
        throw new Error('Smart Format does not lay out JSON Lines documents.');
      return smartFormat(text, format);
    case 'compact':
      return adapter.compact(text);
    case 'repair':
      return repair(text, format).text;
    case 'repairLines':
      return repairLines(text).text;
    case 'sort':
      return adapter.sort(text, { path: action.path, order: action.order });
  }
}

function applyJsonPatch(text: string, patch: JsonPatchOperation[]): string {
  const data: unknown = JSON.parse(text);
  const patched = immutableJSONPatch<unknown>(data, patch);
  return JSON.stringify(patched, null, 2) + '\n';
}
