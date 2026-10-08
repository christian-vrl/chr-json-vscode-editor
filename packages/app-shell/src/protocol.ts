// Versioned message protocol between the editor UI and its host (003 T1, plan 003 step A).
// Pure TypeScript with no imports, no DOM and no Node APIs, so the VS Code extension host, the
// webview and the Chrome app can all import it. Every message carries `protocol` (bumped on any
// incompatible change) and `docVersion`, so a receiver can drop echoes and stale messages.

/** Bump on any change a receiver built against the previous version could not decode. */
export const PROTOCOL_VERSION = 1;

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
  { kind: 'patch'; patch: JsonPatchOperation[] } | { kind: 'text'; text: string };

interface Envelope<T extends string> {
  protocol: typeof PROTOCOL_VERSION;
  type: T;
  /**
   * Host → UI: the document version the message describes. UI → host: the version the UI had
   * when it produced the message, so the host can tell a stale edit from a current one.
   */
  docVersion: number;
}

/** First message for a document: its text, detected format, starting mode and settings. */
export interface InitMessage extends Envelope<'init'> {
  text: string;
  format: Format;
  mode: Mode;
  settings: EditorSettings;
}
/** The document changed outside the UI (another editor, undo, Git, ...). */
export interface UpdateMessage extends Envelope<'update'> {
  text: string;
}
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
/** A failure the other side should show; `code` is machine-readable, `message` is for people. */
export interface ErrorMessage extends Envelope<'error'> {
  code: string;
  message: string;
}

export type ToWebviewMessage =
  InitMessage | UpdateMessage | SetModeMessage | SetFormatMessage | ErrorMessage;
export type ToHostMessage = EditMessage | ErrorMessage;
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
  docVersion: (v, name) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
      throw new Invalid(`${name} must be a non-negative integer`);
    }
    return v;
  },
};

const TO_WEBVIEW: Record<ToWebviewMessage['type'], Fields> = {
  init: { text: str, format: oneOf(FORMATS), mode: oneOf(MODES), settings: jsonObject },
  update: { text: str },
  setMode: { mode: oneOf(MODES) },
  setFormat: { format: oneOf(FORMATS) },
  error: { code: str, message: str },
};

const TO_HOST: Record<ToHostMessage['type'], Fields> = {
  edit: { change: documentChange },
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

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new Invalid(`${name} must be a string`);
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
  throw new Invalid(`${name}.kind must be patch or text`);
}

function patchList(v: unknown, name: string): JsonPatchOperation[] {
  if (!Array.isArray(v)) throw new Invalid(`${name} must be an array`);
  return v.map((op, i) => patchOperation(op, `${name}[${i}]`));
}
