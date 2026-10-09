// Versioned message protocol between the editor UI and its host (003 T1, plan 003 step A).
// Pure TypeScript with no imports, no DOM and no Node APIs, so the VS Code extension host, the
// webview and the Chrome app can all import it. Every message carries `protocol` (bumped on any
// incompatible change) and `docVersion`, so a receiver can drop echoes and stale messages.

/** Bump on any change a receiver built against the previous version could not decode.
 *  2: adds the host → UI `validation` message (004 T2).
 *  3: `validation` carries the schema's `dialect` (004 T4).
 *  4: adds the draft-04 and draft-06 dialects (004 T4, UNK-031).
 *  5: adds the UI → host `ready` message (003 T5).
 *  6: `update` says whether it answers the UI's edit (`origin`); edit errors have fixed codes
 *     (003 T5).
 *  7: `validation` says whether the dialect can be switched (`switchable`) and has a `none` result;
 *     adds the UI → host `setDialect` message (004 T5).
 *  8: adds the UI → host `undo` and `redo` messages, and the host → UI `flush` request with its
 *     UI → host `flushed` answer (003 T7).
 *  9: `edit` can carry a whole-document action (`kind: 'action'`, 003 T8).
 * 10: `init` carries `largeFile`; adds the UI → host `openAsText` and `unlock` messages and the
 *     `read-only` edit error (008 T2). */
export const PROTOCOL_VERSION = 10;

/** AGENTS.md §Glossary "Format". */
export type Format = 'json' | 'jsonc' | 'json5';
export const FORMATS: readonly Format[] = ['json', 'jsonc', 'json5'];

/** Editor modes (spec 003 §Goal). */
export type Mode = 'tree' | 'text' | 'table';
export const MODES: readonly Mode[] = ['tree', 'text', 'table'];

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Settings snapshot the host sends with `init`; keys are defined by spec 019. */
export type EditorSettings = { readonly [key: string]: JsonValue };

/** One RFC 6902 operation. `path` and `from` are RFC 6901 JSON Pointers. */
export type JsonPatchOperation =
  | { op: 'add' | 'replace' | 'test'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string };

/**
 * A change the UI asks the host to apply. Tree and table modes send a JSON Patch (applied by
 * `core.applyPatch` in the host, plan 003 §Constraints); text mode sends the whole new text and the
 * host diffs it (plan 003 risk R3, task T6).
 */
export type DocumentChange =
  | { kind: 'patch'; patch: JsonPatchOperation[] }
  | { kind: 'text'; text: string }
  | { kind: 'action'; action: DocumentAction };

/**
 * A whole-document action the host runs with core on the document's text (003 T8, 002 R12–R13,
 * UNK-018), so comments and style are kept: `format` (core `prettyPrint`), `compact`, `repair`, and
 * `sort`, which puts the members of the container at `path` in `order` (their indices before the
 * sort), the order the editor's sort chose. Data-level changes (transform) are a `patch` made by
 * core's `diff` (002 R14).
 */
export type DocumentAction =
  { name: 'format' | 'compact' | 'repair' } | { name: 'sort'; path: string; order: number[] };
export const ACTION_NAMES = ['format', 'compact', 'repair', 'sort'] as const;

interface Envelope<T extends string> {
  protocol: typeof PROTOCOL_VERSION;
  type: T;
  /**
   * Host → UI: the document version the message describes. UI → host: the version the UI had
   * when it produced the message, so the host can tell a stale edit from a current one.
   */
  docVersion: number;
}

/**
 * The UI is listening and asks for the document (003 T5). A webview's script starts after the host
 * set its HTML, so a message the host posted before then would be lost; the host sends `init` (and
 * any state the UI needs again, such as the latest `validation`) only in answer to `ready`. The UI
 * has no document yet, so `docVersion` is 0. A reloaded webview sends it again.
 */
export interface ReadyMessage extends Envelope<'ready'> {
  docVersion: 0;
}
/** First message for a document: its text, detected format, starting mode and settings. */
export interface InitMessage extends Envelope<'init'> {
  text: string;
  format: Format;
  mode: Mode;
  settings: EditorSettings;
  /** Set when the document opened in large-file mode (spec 008), `null` for the normal editor. */
  largeFile: LargeFile | null;
}
/**
 * Large-file mode (spec 008, UNK-040): the host chose it when the tab opened, for a text of more
 * than 5 MiB. `bytes` is the text's UTF-8 length then. A locked tab is read-only (criterion 2);
 * `unlocked` once the user chose "Edit anyway" (criterion 4), which lasts until the tab closes, so
 * a reloaded webview gets it again in `init`.
 */
export interface LargeFile {
  bytes: number;
  unlocked: boolean;
}
/**
 * The document's text at `docVersion`. `origin: 'edit'` answers the UI's oldest unanswered `edit`:
 * the host applied it, and this is the text it produced (`docVersion` stays the same when the edit
 * changed nothing). `origin: 'external'` is a change made anywhere else (another editor, undo, Git).
 */
export interface UpdateMessage extends Envelope<'update'> {
  text: string;
  origin: UpdateOrigin;
}
export type UpdateOrigin = 'edit' | 'external';
export const UPDATE_ORIGINS: readonly UpdateOrigin[] = ['edit', 'external'];
/** The UI's change to the document. */
export interface EditMessage extends Envelope<'edit'> {
  change: DocumentChange;
}
/** Switch the UI to another mode. */
export interface SetModeMessage extends Envelope<'setMode'> {
  mode: Mode;
}
/** Re-parse the document as another format without changing its bytes (spec 003 criterion 8). */
export interface SetFormatMessage extends Envelope<'setFormat'> {
  format: Format;
}
/**
 * The user's choice of dialect for a schema whose own `$schema` names none this editor knows
 * (UNK-017's one-click switch, 004 T5). The host validates again with it and answers with a
 * `validation`; it applies only while the dialect is `switchable`.
 */
export interface SetDialectMessage extends Envelope<'setDialect'> {
  dialect: SchemaDialect;
}
/**
 * Undo or redo in the host's history of the document (003 T7, spec 003 criterion 3, plan 003 risk
 * R1). The UI keeps no undo history of its own: its undo and redo keys and buttons send these, so
 * the document's one history (VS Code's, which also holds changes made in other editors) decides
 * what changes. Sent after every `edit` the UI made before it, in order. There is no answer of its
 * own: a change it makes comes back as an `update` with origin `external`.
 */
export type UndoMessage = Envelope<'undo'>;
export type RedoMessage = Envelope<'redo'>;
/**
 * The host is about to save the document (003 T7). The UI hands over any change it still holds,
 * such as typing text mode has not reported yet (text-mode.ts), and answers `flushed` with the same
 * `request` once every `edit` it made is answered, so the saved file has what the user sees.
 */
export interface FlushMessage extends Envelope<'flush'> {
  request: number;
}
export interface FlushedMessage extends Envelope<'flushed'> {
  request: number;
}
/**
 * "Open as Text" in the large-file banner (spec 008 criterion 3): the host replaces the tab with
 * VS Code's text editor on the same document ("Reopen as Text"). No answer; the webview goes away.
 */
export type OpenAsTextMessage = Envelope<'openAsText'>;
/**
 * "Edit anyway" in the large-file banner (spec 008 criterion 4): the host lets this tab edit from
 * now on, until it closes. No answer: the UI unlocks itself when it sends this, and every `edit`
 * it sends after it reaches the host after it.
 */
export type UnlockMessage = Envelope<'unlock'>;
/** A failure the other side should show; `code` is machine-readable, `message` is for people. */
export interface ErrorMessage extends Envelope<'error'> {
  code: string;
  message: string;
}

/**
 * The host's answers to an `edit` it did not apply; each one answers the UI's oldest unanswered
 * `edit`, like an `update` with `origin: 'edit'`, and carries the document's current `docVersion`.
 * - `stale-edit`: the edit was made on an older `docVersion` than the document's.
 * - `patch-failed`: a patch operation did not apply to the text (core's `PatchError`).
 * - `edit-failed`: the editor refused the change (VS Code's `applyEdit` returned false).
 * - `read-only`: the tab is a locked large-file tab (spec 008 criterion 2), so the host applies no
 *   change from it. A locked tab's UI sends none; the host checks anyway (plan 008 risk R3).
 */
export const EDIT_ERROR_CODES = ['stale-edit', 'patch-failed', 'edit-failed', 'read-only'] as const;
export type EditErrorCode = (typeof EDIT_ERROR_CODES)[number];

export function isEditError(message: ErrorMessage): boolean {
  return (EDIT_ERROR_CODES as readonly string[]).includes(message.code);
}

/** JSON Schema dialects the validator supports (spec 004 criterion 2, UNK-017, UNK-031). */
export type SchemaDialect = 'draft-04' | 'draft-06' | 'draft-07' | '2019-09' | '2020-12';
export const SCHEMA_DIALECTS: readonly SchemaDialect[] = [
  'draft-04',
  'draft-06',
  'draft-07',
  '2019-09',
  '2020-12',
];

/** One JSON Schema error. `instancePath` is the RFC 6901 pointer to the value (Ajv's own field). */
export interface SchemaError {
  instancePath: string;
  keyword: string;
  message: string;
}

/**
 * Schema validation of the document at `docVersion` (004 T2, ADR-010: the host runs the validator,
 * since the webview CSP forbids eval). `errors` lists every error, empty when the document is
 * valid; `skipped` says why the document was not validated (it does not parse, the schema cannot
 * be read or does not compile, or it is remote); `none` says no schema applies to the document any
 * more, so the UI drops the errors it shows. A UI shows only the result for its current version.
 */
export interface ValidationMessage extends Envelope<'validation'> {
  /** The JSON Schema dialect the schema ran as (spec 004 criterion 2). `switchable` when the
   *  schema has no `$schema`, or one naming no known dialect, so the user's `setDialect` applies;
   *  `assumed` when it is also not chosen yet, so the UI can say "assumed draft-07". `null` when no
   *  dialect applies (no schema, or one naming a draft before 04, which is not supported). */
  dialect: SchemaDialectChoice | null;
  result:
    | { kind: 'errors'; errors: SchemaError[] }
    | { kind: 'skipped'; reason: string }
    | { kind: 'none' };
}

export interface SchemaDialectChoice {
  name: SchemaDialect;
  assumed: boolean;
  switchable: boolean;
}

export type ToWebviewMessage =
  | InitMessage
  | UpdateMessage
  | SetModeMessage
  | SetFormatMessage
  | ErrorMessage
  | ValidationMessage
  | FlushMessage;
export type ToHostMessage =
  | ReadyMessage
  | EditMessage
  | SetDialectMessage
  | UndoMessage
  | RedoMessage
  | FlushedMessage
  | OpenAsTextMessage
  | UnlockMessage
  | ErrorMessage;
export type ProtocolMessage = ToWebviewMessage | ToHostMessage;

export type DecodeResult<M> = { ok: true; message: M } | { ok: false; error: string };

/** Validates data received from the host; returns a fresh message or the reason it was rejected. */
export function decodeToWebview(data: unknown): DecodeResult<ToWebviewMessage> {
  return decode(data, TO_WEBVIEW);
}

/** Validates data received from the UI; returns a fresh message or the reason it was rejected. */
export function decodeToHost(data: unknown): DecodeResult<ToHostMessage> {
  return decode(data, TO_HOST);
}

// Decoding. A field reader returns the decoded value or throws Invalid; unknown keys are rejected
// so a typo or a newer sender fails loudly instead of being half-understood.

class Invalid extends Error {}

type Fields = Record<string, (value: unknown, name: string) => unknown>;

const BASE: Fields = {
  protocol: (v) => v,
  type: (v) => v,
  docVersion: count,
};

const TO_WEBVIEW: Record<ToWebviewMessage['type'], Fields> = {
  init: {
    text: str,
    format: oneOf(FORMATS),
    mode: oneOf(MODES),
    settings: jsonObject,
    largeFile: largeFile,
  },
  update: { text: str, origin: oneOf(UPDATE_ORIGINS) },
  setMode: { mode: oneOf(MODES) },
  setFormat: { format: oneOf(FORMATS) },
  error: { code: str, message: str },
  validation: { dialect: schemaDialect, result: validationResult },
  flush: { request: count },
};

const TO_HOST: Record<ToHostMessage['type'], Fields> = {
  ready: { docVersion: zero },
  edit: { change: documentChange },
  setDialect: { dialect: oneOf(SCHEMA_DIALECTS) },
  undo: {},
  redo: {},
  flushed: { request: count },
  openAsText: {},
  unlock: {},
  error: { code: str, message: str },
};

function decode<M>(data: unknown, table: Record<string, Fields>): DecodeResult<M> {
  try {
    const raw = record(data, 'message');
    if (raw.protocol !== PROTOCOL_VERSION) {
      throw new Invalid(`protocol must be ${PROTOCOL_VERSION}, got ${String(raw.protocol)}`);
    }
    const type = raw.type;
    if (typeof type !== 'string' || !Object.hasOwn(table, type)) {
      throw new Invalid(`unexpected message type ${JSON.stringify(type)}`);
    }
    const message = readFields(raw, { ...BASE, ...table[type] }, type);
    return { ok: true, message: message as M };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

function readFields(raw: Record<string, unknown>, fields: Fields, where: string) {
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(fields, key)) throw new Invalid(`${where}: unexpected property ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(fields)) {
    if (!Object.hasOwn(raw, key)) throw new Invalid(`${where}: missing ${key}`);
    out[key] = read(raw[key], `${where}.${key}`);
  }
  return out;
}

function record(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Invalid(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

function count(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw new Invalid(`${name} must be a non-negative integer`);
  }
  return v;
}

function zero(v: unknown, name: string): 0 {
  if (v !== 0) throw new Invalid(`${name} must be 0`);
  return v;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Invalid(`${name} must be a string`);
  return v;
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw new Invalid(`${name} must be a boolean`);
  return v;
}

function oneOf<T extends string>(allowed: readonly T[]) {
  return (v: unknown, name: string): T => {
    if (!allowed.includes(v as T))
      throw new Invalid(`${name} must be one of ${allowed.join(', ')}`);
    return v as T;
  };
}

function pointer(v: unknown, name: string): string {
  const s = str(v, name);
  if (s !== '' && !s.startsWith('/')) throw new Invalid(`${name} must be a JSON Pointer`);
  return s;
}

function json(v: unknown, name: string): JsonValue {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Invalid(`${name} must be a finite number`);
    return v;
  }
  if (Array.isArray(v)) return v.map((item, i) => json(item, `${name}[${i}]`));
  return jsonObject(v, name);
}

function jsonObject(v: unknown, name: string): { [key: string]: JsonValue } {
  const raw = record(v, name);
  const proto = Object.getPrototypeOf(raw) as unknown;
  if (proto !== Object.prototype && proto !== null)
    throw new Invalid(`${name} must be a plain object`);
  const out: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(raw)) {
    // defineProperty, not assignment, so a "__proto__" key stays data.
    Object.defineProperty(out, key, {
      value: json(item, `${name}.${key}`),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const PATCH_FIELDS: Record<JsonPatchOperation['op'], Fields> = {
  add: { op: str, path: pointer, value: json },
  replace: { op: str, path: pointer, value: json },
  test: { op: str, path: pointer, value: json },
  remove: { op: str, path: pointer },
  move: { op: str, from: pointer, path: pointer },
  copy: { op: str, from: pointer, path: pointer },
};

function patchOperation(v: unknown, name: string): JsonPatchOperation {
  const raw = record(v, name);
  const op = raw.op;
  if (typeof op !== 'string' || !Object.hasOwn(PATCH_FIELDS, op)) {
    throw new Invalid(`${name}.op must be one of ${Object.keys(PATCH_FIELDS).join(', ')}`);
  }
  return readFields(raw, PATCH_FIELDS[op as JsonPatchOperation['op']], name) as JsonPatchOperation;
}

function documentChange(v: unknown, name: string): DocumentChange {
  const raw = record(v, name);
  if (raw.kind === 'text') return readFields(raw, { kind: str, text: str }, name) as DocumentChange;
  if (raw.kind === 'patch') {
    return readFields(raw, { kind: str, patch: patchList }, name) as DocumentChange;
  }
  if (raw.kind === 'action') {
    return readFields(raw, { kind: str, action: documentAction }, name) as DocumentChange;
  }
  throw new Invalid(`${name}.kind must be patch, text or action`);
}

function documentAction(v: unknown, name: string): DocumentAction {
  const raw = record(v, name);
  const action = oneOf(ACTION_NAMES)(raw.name, `${name}.name`);
  if (action === 'sort') {
    return readFields(raw, { name: str, path: pointer, order: indexList }, name) as DocumentAction;
  }
  return readFields(raw, { name: str }, name) as DocumentAction;
}

function indexList(v: unknown, name: string): number[] {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be an array`);
  return v.map((n, i) => {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
      throw new Invalid(`${name}[${i}] must be a non-negative integer`);
    }
    return n;
  });
}

function patchList(v: unknown, name: string): JsonPatchOperation[] {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be an array`);
  return v.map((op, i) => patchOperation(op, `${name}[${i}]`));
}

function largeFile(v: unknown, name: string): LargeFile | null {
  if (v === null) return null;
  return readFields(
    record(v, name),
    { bytes: count, unlocked: bool },
    name,
  ) as unknown as LargeFile;
}

function schemaDialect(v: unknown, name: string): ValidationMessage['dialect'] {
  if (v === null) return null;
  const fields = { name: oneOf(SCHEMA_DIALECTS), assumed: bool, switchable: bool };
  return readFields(record(v, name), fields, name) as unknown as SchemaDialectChoice;
}

function validationResult(v: unknown, name: string): ValidationMessage['result'] {
  const raw = record(v, name);
  if (raw.kind === 'none')
    return readFields(raw, { kind: str }, name) as ValidationMessage['result'];
  if (raw.kind === 'skipped') {
    return readFields(raw, { kind: str, reason: str }, name) as ValidationMessage['result'];
  }
  if (raw.kind === 'errors') {
    return readFields(
      raw,
      { kind: str, errors: schemaErrorList },
      name,
    ) as ValidationMessage['result'];
  }
  throw new Invalid(`${name}.kind must be errors, skipped or none`);
}

function schemaErrorList(v: unknown, name: string): SchemaError[] {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be an array`);
  return v.map((e, i) => {
    const where = `${name}[${i}]`;
    const fields = { instancePath: pointer, keyword: str, message: str };
    return readFields(record(e, where), fields, where) as unknown as SchemaError;
  });
}
