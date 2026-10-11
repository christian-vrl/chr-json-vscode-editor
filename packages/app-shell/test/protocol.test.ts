// Gate for 003 T1: every protocol message survives the trip a webview message takes (JSON text and
// structured clone) and decodes back to an equal value; malformed messages are rejected.
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeToCompareHost,
  decodeToComparePage,
  decodeToHost,
  decodeToWebview,
  type ToCompareHostMessage,
  type ToComparePageMessage,
  type ToHostMessage,
  type ToWebviewMessage,
} from '../src/protocol.js';

const toWebview: ToWebviewMessage[] = [
  {
    protocol: PROTOCOL_VERSION,
    type: 'init',
    docVersion: 1,
    text: '{\n  // note\n  "a": 1,\n}\n',
    format: 'jsonc',
    mode: 'tree',
    settings: { indent: 2, nested: { list: [true, null, 'x'] } },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'update',
    docVersion: 2,
    text: "{a: 'b'}",
    origin: 'external',
  },
  { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 2, text: '{}', origin: 'edit' },
  { protocol: PROTOCOL_VERSION, type: 'setMode', docVersion: 2, mode: 'table' },
  { protocol: PROTOCOL_VERSION, type: 'setFormat', docVersion: 2, format: 'json5' },
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 3, code: 'stale', message: 'Edit on 2' },
  {
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 4,
    dialect: { name: '2020-12', assumed: false, switchable: false },
    result: {
      kind: 'errors',
      errors: [
        { instancePath: '', keyword: 'required', message: "must have required property 'name'" },
        { instancePath: '/age', keyword: 'type', message: 'must be integer' },
      ],
    },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 5,
    dialect: { name: 'draft-07', assumed: true, switchable: true },
    result: { kind: 'errors', errors: [] },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 5,
    dialect: { name: 'draft-04', assumed: false, switchable: true },
    result: { kind: 'errors', errors: [] },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 7,
    dialect: null,
    result: { kind: 'none' },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 6,
    dialect: null,
    result: { kind: 'skipped', reason: 'Schema draft not supported (draft-03).' },
  },
  { protocol: PROTOCOL_VERSION, type: 'flush', docVersion: 8, request: 3 },
];

const toHost: ToHostMessage[] = [
  { protocol: PROTOCOL_VERSION, type: 'ready', docVersion: 0 },
  {
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 2,
    change: {
      kind: 'patch',
      patch: [
        { op: 'add', path: '/b', value: { c: [1, 2.5, -3e2] } },
        { op: 'remove', path: '/a' },
        { op: 'replace', path: '', value: null },
        { op: 'move', from: '/x', path: '/y' },
        { op: 'copy', from: '/x', path: '/z~1w' },
        { op: 'test', path: '/k', value: 'v' },
      ],
    },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 0,
    change: { kind: 'text', text: '' },
  },
  ...(['format', 'compact', 'repair'] as const).map((name): ToHostMessage => ({
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 4,
    change: { kind: 'action', action: { name } },
  })),
  {
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 4,
    change: { kind: 'action', action: { name: 'sort', path: '/a~1b/0', order: [2, 0, 1] } },
  },
  { protocol: PROTOCOL_VERSION, type: 'setDialect', docVersion: 3, dialect: 'draft-04' },
  { protocol: PROTOCOL_VERSION, type: 'undo', docVersion: 4 },
  { protocol: PROTOCOL_VERSION, type: 'redo', docVersion: 5 },
  { protocol: PROTOCOL_VERSION, type: 'flushed', docVersion: 5, request: 3 },
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 5, code: 'parse', message: 'Bad' },
];

describe('protocol round trip', () => {
  it.each(toWebview.map((m) => [m.type, m] as const))('host → webview %s', (_type, message) => {
    expect(decodeToWebview(JSON.parse(JSON.stringify(message)))).toEqual({ ok: true, message });
    expect(decodeToWebview(structuredClone(message))).toEqual({ ok: true, message });
  });

  it.each(toHost.map((m, i) => [`${m.type} #${i}`, m] as const))('webview → host %s', (_n, m) => {
    expect(decodeToHost(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
    expect(decodeToHost(structuredClone(m))).toEqual({ ok: true, message: m });
  });

  it('covers every message type (003 T1; validation, setDialect: 004; ready: 003 T5; undo, redo, flush, flushed: 003 T7)', () => {
    const types = new Set([...toWebview, ...toHost].map((m) => m.type));
    expect([...types].sort()).toEqual(
      [
        'edit',
        'error',
        'flush',
        'flushed',
        'init',
        'ready',
        'redo',
        'undo',
        'setDialect',
        'setFormat',
        'setMode',
        'update',
        'validation',
      ].sort(),
    );
  });

  it('keeps a "__proto__" settings key as data', () => {
    const data: unknown = JSON.parse(
      `{"protocol":${PROTOCOL_VERSION},"type":"init","docVersion":0,"text":"","format":"json",` +
        `"mode":"text","settings":{"__proto__":{"polluted":true}}}`,
    );
    const result = decodeToWebview(data);
    expect(result.ok).toBe(true);
    const settings = result.ok && result.message.type === 'init' ? result.message.settings : {};
    expect(Object.keys(settings)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns a fresh object, not the input', () => {
    const input = structuredClone(toWebview[1]);
    const result = decodeToWebview(input);
    expect(result.ok && result.message).not.toBe(input);
  });
});

describe('protocol rejects malformed messages', () => {
  const update = {
    protocol: PROTOCOL_VERSION,
    type: 'update',
    docVersion: 1,
    text: 'x',
    origin: 'external',
  };
  const validation = (result: unknown, dialect: unknown = null) => ({
    protocol: PROTOCOL_VERSION,
    type: 'validation',
    docVersion: 1,
    dialect,
    result,
  });
  const edit = {
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 1,
    change: { kind: 'text', text: 'x' },
  };

  it.each([
    ['not an object', 'update'],
    ['null', null],
    ['an array', [update]],
    ['another protocol version', { ...update, protocol: PROTOCOL_VERSION + 1 }],
    ['no protocol version', { type: 'update', docVersion: 1, text: 'x', origin: 'edit' }],
    [
      'an update without origin',
      { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 1, text: 'x' },
    ],
    ['an unknown update origin', { ...update, origin: 'undo' }],
    ['protocol 5 (before update origins)', { ...update, protocol: 5 }],
    ['an unknown type', { ...update, type: 'save' }],
    ['a direction it cannot travel', edit],
    ['no docVersion', { protocol: PROTOCOL_VERSION, type: 'update', text: 'x', origin: 'edit' }],
    ['a negative docVersion', { ...update, docVersion: -1 }],
    ['a fractional docVersion', { ...update, docVersion: 1.5 }],
    ['a string docVersion', { ...update, docVersion: '1' }],
    ['a non-string text', { ...update, text: 1 }],
    ['an extra property', { ...update, extra: true }],
    [
      'an unknown mode',
      { protocol: PROTOCOL_VERSION, type: 'setMode', docVersion: 1, mode: 'graph' },
    ],
    [
      'an unknown format',
      { protocol: PROTOCOL_VERSION, type: 'setFormat', docVersion: 1, format: 'yaml' },
    ],
    [
      'an error without code',
      { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 1, message: 'm' },
    ],
    ['protocol 1 (before validation existed)', { ...update, protocol: 1 }],
    ['protocol 2 (before validation carried its dialect)', { ...update, protocol: 2 }],
    ['protocol 3 (before draft-04 and draft-06)', { ...update, protocol: 3 }],
    ['protocol 4 (before ready)', { ...update, protocol: 4 }],
    ['protocol 6 (before switchable dialects)', { ...update, protocol: 6 }],
    ['protocol 7 (before undo, redo and flush)', { ...update, protocol: 7 }],
    ['protocol 9 (before compare)', { ...update, protocol: 9 }],
    ['a compare message', toComparePage[0]],
    ['a flush without request', { protocol: PROTOCOL_VERSION, type: 'flush', docVersion: 1 }],
    [
      'a flush with a negative request',
      { protocol: PROTOCOL_VERSION, type: 'flush', docVersion: 1, request: -1 },
    ],
    [
      'a validation without result',
      { protocol: PROTOCOL_VERSION, type: 'validation', docVersion: 1 },
    ],
    ['an unknown validation kind', validation({ kind: 'pending' })],
    ['validation errors that are not an array', validation({ kind: 'errors', errors: {} })],
    [
      'a validation error whose path is not a JSON Pointer',
      validation({
        kind: 'errors',
        errors: [{ instancePath: 'age', keyword: 'type', message: 'm' }],
      }),
    ],
    [
      'a validation error without keyword',
      validation({ kind: 'errors', errors: [{ instancePath: '', message: 'm' }] }),
    ],
    ['a skipped validation without reason', validation({ kind: 'skipped' })],
    [
      'a validation without dialect',
      {
        protocol: PROTOCOL_VERSION,
        type: 'validation',
        docVersion: 1,
        result: { kind: 'skipped', reason: 'r' },
      },
    ],
    [
      'an unknown schema dialect',
      validation(
        { kind: 'errors', errors: [] },
        { name: 'draft-03', assumed: false, switchable: false },
      ),
    ],
    [
      'a dialect whose assumed flag is not a boolean',
      validation(
        { kind: 'errors', errors: [] },
        { name: 'draft-07', assumed: 'yes', switchable: true },
      ),
    ],
    [
      'a dialect without its switchable flag (protocol 6)',
      validation({ kind: 'errors', errors: [] }, { name: 'draft-07', assumed: true }),
    ],
    ['a none result with a reason', validation({ kind: 'none', reason: 'r' })],
    ['init settings that are not JSON', { ...toWebview[0], settings: { f: Number.NaN } }],
  ])('host → webview: %s', (_why, data) => {
    const result = decodeToWebview(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });

  const patchEdit = (patch: unknown) => ({ ...edit, change: { kind: 'patch', patch } });
  const actionEdit = (action: unknown) => ({ ...edit, change: { kind: 'action', action } });

  it.each([
    ['an update', update],
    ['an unknown change kind', { ...edit, change: { kind: 'diff', text: 'x' } }],
    ['a text change without text', { ...edit, change: { kind: 'text' } }],
    ['a patch that is not an array', patchEdit({ op: 'remove', path: '/a' })],
    ['an unknown patch op', patchEdit([{ op: 'merge', path: '/a', value: 1 }])],
    ['a path that is not a JSON Pointer', patchEdit([{ op: 'remove', path: 'a' }])],
    ['add without value', patchEdit([{ op: 'add', path: '/a' }])],
    ['move without from', patchEdit([{ op: 'move', path: '/a' }])],
    ['remove with a value', patchEdit([{ op: 'remove', path: '/a', value: 1 }])],
    ['a value that is not JSON', patchEdit([{ op: 'add', path: '/a', value: Infinity }])],
    ['a nested undefined', patchEdit([{ op: 'add', path: '/a', value: [undefined] }])],
    ['an unknown action', actionEdit({ name: 'beautify' })],
    ['an action that is not an object', actionEdit('format')],
    ['a format action with a path', actionEdit({ name: 'format', path: '' })],
    ['a sort without order', actionEdit({ name: 'sort', path: '' })],
    ['a sort with a negative index', actionEdit({ name: 'sort', path: '', order: [0, -1] })],
    ['a sort with a fractional index', actionEdit({ name: 'sort', path: '', order: [0.5] })],
    ['a sort whose path is not a pointer', actionEdit({ name: 'sort', path: 'a', order: [] })],
    [
      'a ready with a document version',
      { protocol: PROTOCOL_VERSION, type: 'ready', docVersion: 1 },
    ],
    ['a ready from protocol 4', { protocol: 4, type: 'ready', docVersion: 0 }],
    [
      'an unknown dialect to switch to',
      { protocol: PROTOCOL_VERSION, type: 'setDialect', docVersion: 1, dialect: 'draft-03' },
    ],
    [
      'a setDialect without dialect',
      { protocol: PROTOCOL_VERSION, type: 'setDialect', docVersion: 1 },
    ],
    ['an undo from protocol 7', { protocol: 7, type: 'undo', docVersion: 1 }],
    ['an undo with a count', { protocol: PROTOCOL_VERSION, type: 'undo', docVersion: 1, steps: 2 }],
    ['a redo without docVersion', { protocol: PROTOCOL_VERSION, type: 'redo' }],
    ['a flushed without request', { protocol: PROTOCOL_VERSION, type: 'flushed', docVersion: 1 }],
    [
      'a flushed with a string request',
      { protocol: PROTOCOL_VERSION, type: 'flushed', docVersion: 1, request: '1' },
    ],
    [
      'a flush (host → webview only)',
      { protocol: PROTOCOL_VERSION, type: 'flush', docVersion: 1, request: 1 },
    ],
  ])('webview → host: %s', (_why, data) => {
    const result = decodeToHost(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });
});

// 007 T4: the compare panel's messages travel the same way and are decoded by their own tables.
const toComparePage: ToComparePageMessage[] = [
  {
    protocol: PROTOCOL_VERSION,
    type: 'compare',
    docVersion: 3,
    left: {
      name: 'data.jsonc (HEAD)',
      format: 'jsonc',
      content: { kind: 'text', text: '{\n  // c\n  "a": [1, 2]\n}\n' },
      writable: false,
    },
    right: {
      name: 'data.jsonc',
      format: 'jsonc',
      content: { kind: 'text', text: '{"a": [1, 3], "b": {}}' },
      writable: true,
    },
    differences: [
      { kind: 'changed', leftPath: '/a/1', rightPath: '/a/1' },
      { kind: 'added', rightPath: '/b' },
      { kind: 'removed', leftPath: '/c~1d' },
    ],
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'compare',
    docVersion: 0,
    left: {
      name: 'a.json5',
      format: 'json5',
      content: { kind: 'error', message: 'Unexpected end at line 1, column 2' },
      writable: true,
    },
    right: { name: 'b.json', format: 'json', content: { kind: 'text', text: '' }, writable: true },
    differences: [],
  },
];

const toCompareHost: ToCompareHostMessage[] = [
  { protocol: PROTOCOL_VERSION, type: 'compareReady', docVersion: 0 },
  {
    protocol: PROTOCOL_VERSION,
    type: 'copy',
    docVersion: 4,
    difference: { kind: 'changed', leftPath: '', rightPath: '' },
    to: 'left',
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'copy',
    docVersion: 4,
    difference: { kind: 'removed', leftPath: '/include/1' },
    to: 'right',
  },
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 4, code: 'c', message: 'm' },
];

describe('compare protocol (007 T4)', () => {
  it.each(toComparePage.map((m, i) => [`#${i}`, m] as const))('host → page %s', (_n, m) => {
    expect(decodeToComparePage(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
    expect(decodeToComparePage(structuredClone(m))).toEqual({ ok: true, message: m });
  });

  it.each(toCompareHost.map((m, i) => [`${m.type} #${i}`, m] as const))(
    'page → host %s',
    (_n, m) => {
      expect(decodeToCompareHost(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
      expect(decodeToCompareHost(structuredClone(m))).toEqual({ ok: true, message: m });
    },
  );

  const compareMessage = toComparePage[0]!;
  const copy = (difference: unknown, to: unknown = 'left') => ({
    protocol: PROTOCOL_VERSION,
    type: 'copy',
    docVersion: 1,
    difference,
    to,
  });

  it.each([
    ['protocol 9 (before compare)', { ...compareMessage, protocol: 9 }],
    [
      'an editor message',
      { protocol: PROTOCOL_VERSION, type: 'setMode', docVersion: 1, mode: 'tree' },
    ],
    [
      'a side without writable',
      { ...compareMessage, left: { ...compareMessage.left, writable: undefined } },
    ],
    [
      'a side with an unknown content kind',
      { ...compareMessage, left: { ...compareMessage.left, content: { kind: 'data', data: 1 } } },
    ],
    [
      'an added difference with a left path',
      { ...compareMessage, differences: [{ kind: 'added', leftPath: '/a', rightPath: '/a' }] },
    ],
    [
      'a changed difference without its right path',
      { ...compareMessage, differences: [{ kind: 'changed', leftPath: '/a' }] },
    ],
    [
      'a difference path that is not a pointer',
      { ...compareMessage, differences: [{ kind: 'removed', leftPath: 'a' }] },
    ],
  ])('host → page: %s', (_why, data) => {
    const result = decodeToComparePage(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });

  it.each([
    [
      'a compareReady with a version',
      { protocol: PROTOCOL_VERSION, type: 'compareReady', docVersion: 1 },
    ],
    ['an editor ready', { protocol: PROTOCOL_VERSION, type: 'ready', docVersion: 0 }],
    ['a copy to a third side', copy({ kind: 'added', rightPath: '/a' }, 'middle')],
    ['a copy of an unknown kind', copy({ kind: 'moved', leftPath: '/a', rightPath: '/b' })],
    [
      'a removed difference with a right path',
      copy({ kind: 'removed', leftPath: '/a', rightPath: '/a' }),
    ],
  ])('page → host: %s', (_why, data) => {
    const result = decodeToCompareHost(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });
});
