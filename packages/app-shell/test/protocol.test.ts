// Gate for 003 T1: every protocol message survives the trip a webview message takes (JSON text and
// structured clone) and decodes back to an equal value; malformed messages are rejected.
import { LosslessNumber, parseData, valueText } from '@chr-json-editor/core';
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeChange,
  encodeChange,
  type DocumentChange,
  decodeToCompareHost,
  decodeToComparePage,
  decodeToCsvHost,
  decodeToCsvPage,
  decodeToHost,
  decodeToWebview,
  type ToCompareHostMessage,
  type ToComparePageMessage,
  type CsvSourceMessage,
  type ToCsvHostMessage,
  type ToCsvPageMessage,
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
    largeFile: null,
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'init',
    docVersion: 1,
    text: '[]',
    format: 'json5',
    mode: 'table',
    settings: {},
    largeFile: { bytes: 5_242_881, unlocked: false },
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
  { protocol: PROTOCOL_VERSION, type: 'setFormat', docVersion: 2, format: 'jsonl' },
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
  { protocol: PROTOCOL_VERSION, type: 'getRowSource', docVersion: 8, request: 4 },
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
        { op: 'add', path: '/b', valueText: '{"c":[1,2.5,-300]}' },
        { op: 'remove', path: '/a' },
        { op: 'replace', path: '', valueText: 'null' },
        { op: 'move', from: '/x', path: '/y' },
        { op: 'copy', from: '/x', path: '/z~1w' },
        { op: 'test', path: '/k', valueText: '"v"' },
      ],
    },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion: 0,
    change: { kind: 'text', text: '' },
  },
  ...(['format', 'compact', 'repair', 'repairLines'] as const).map((name): ToHostMessage => ({
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
  { protocol: PROTOCOL_VERSION, type: 'openAsText', docVersion: 5 },
  { protocol: PROTOCOL_VERSION, type: 'unlock', docVersion: 5 },
  { protocol: PROTOCOL_VERSION, type: 'rowSource', docVersion: 5, request: 4, path: '' },
  { protocol: PROTOCOL_VERSION, type: 'rowSource', docVersion: 5, request: 5, path: '/a~1b/0' },
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 5, code: 'parse', message: 'Bad' },
];

describe('protocol round trip', () => {
  it.each(toWebview.map((m, i) => [`${m.type} #${i}`, m] as const))(
    'host → webview %s',
    (_n, message) => {
      expect(decodeToWebview(JSON.parse(JSON.stringify(message)))).toEqual({ ok: true, message });
      expect(decodeToWebview(structuredClone(message))).toEqual({ ok: true, message });
    },
  );

  it.each(toHost.map((m, i) => [`${m.type} #${i}`, m] as const))('webview → host %s', (_n, m) => {
    expect(decodeToHost(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
    expect(decodeToHost(structuredClone(m))).toEqual({ ok: true, message: m });
  });

  it('covers every message type (003 T1; validation, setDialect: 004; ready: 003 T5; undo, redo, flush, flushed: 003 T7; openAsText, unlock: 008 T2; getRowSource, rowSource: 009 T4)', () => {
    const types = new Set([...toWebview, ...toHost].map((m) => m.type));
    expect([...types].sort()).toEqual(
      [
        'edit',
        'error',
        'flush',
        'flushed',
        'getRowSource',
        'init',
        'openAsText',
        'ready',
        'rowSource',
        'unlock',
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
        `"mode":"text","settings":{"__proto__":{"polluted":true}},"largeFile":null}`,
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
    ['an init without largeFile (protocol 10)', { ...toWebview[0], largeFile: undefined }],
    ['an init from protocol 10 (before large files)', { ...toWebview[0], protocol: 10 }],
    ['a largeFile without bytes', { ...toWebview[0], largeFile: { unlocked: false } }],
    [
      'a largeFile with a fractional size',
      { ...toWebview[0], largeFile: { bytes: 1.5, unlocked: false } },
    ],
    [
      'a largeFile whose unlocked flag is not a boolean',
      { ...toWebview[0], largeFile: { bytes: 6, unlocked: 1 } },
    ],
    ['a largeFile that is a number', { ...toWebview[0], largeFile: 6 }],
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
    ['an unlock from protocol 10', { protocol: 10, type: 'unlock', docVersion: 1 }],
    [
      'an openAsText with a mode',
      { protocol: PROTOCOL_VERSION, type: 'openAsText', docVersion: 1, mode: 'text' },
    ],
    ['an unlock without docVersion', { protocol: PROTOCOL_VERSION, type: 'unlock' }],
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
    [
      'a rowSource whose path is not a JSON Pointer',
      { protocol: PROTOCOL_VERSION, type: 'rowSource', docVersion: 1, request: 1, path: 'a' },
    ],
    [
      'a rowSource without request',
      { protocol: PROTOCOL_VERSION, type: 'rowSource', docVersion: 1, path: '' },
    ],
    [
      'a rowSource from protocol 11',
      { protocol: 11, type: 'rowSource', docVersion: 1, request: 1, path: '' },
    ],
    [
      'a getRowSource (host → webview only)',
      { protocol: PROTOCOL_VERSION, type: 'getRowSource', docVersion: 1, request: 1 },
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

// 009 T4: the CSV panel's messages travel the same way and are decoded by their own tables.
const exportOptions = {
  delimiter: '\t',
  header: true,
  flattenObjects: false,
  flattenArrays: true,
  bom: true,
} as const;
const importOptions = { delimiter: 'detect', header: false, nestedObjects: true } as const;

const toCsvPage: ToCsvPageMessage[] = [
  {
    protocol: PROTOCOL_VERSION,
    type: 'csvSource',
    docVersion: 0,
    source: {
      mode: 'export',
      name: 'data.json5',
      pointer: '/rows',
      preview: '[{a:NaN,b:-0}]',
      rowCount: 250,
    },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'csvSource',
    docVersion: 0,
    source: {
      mode: 'import',
      name: 'people.csv',
      preview: 'a;b\r\n1;2\r\n',
      complete: false,
      canReplace: true,
    },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'csvOutcome',
    docVersion: 0,
    request: 1,
    outcome: { done: true },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'csvOutcome',
    docVersion: 0,
    request: 2,
    outcome: { error: { message: 'A quote is left open', line: 152 } },
  },
  {
    protocol: PROTOCOL_VERSION,
    type: 'csvOutcome',
    docVersion: 0,
    request: 3,
    outcome: { error: { message: 'CSV export needs an array or an object' } },
  },
];

const toCsvHost: ToCsvHostMessage[] = [
  { protocol: PROTOCOL_VERSION, type: 'csvReady', docVersion: 0 },
  ...(['save', 'copy'] as const).map((action, i): ToCsvHostMessage => ({
    protocol: PROTOCOL_VERSION,
    type: 'csvRun',
    docVersion: 0,
    request: i + 1,
    run: { action, options: exportOptions },
  })),
  ...(['createFile', 'replaceData'] as const).map((action, i): ToCsvHostMessage => ({
    protocol: PROTOCOL_VERSION,
    type: 'csvRun',
    docVersion: 0,
    request: i + 3,
    run: { action, options: { ...importOptions, delimiter: i ? '|' : 'detect' } },
  })),
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 0, code: 'bad-message', message: 'x' },
];

describe('CSV panel messages (009 T4)', () => {
  it.each(toCsvPage.map((m, i) => [`${m.type} #${i}`, m] as const))('host → page %s', (_n, m) => {
    expect(decodeToCsvPage(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
    expect(decodeToCsvPage(structuredClone(m))).toEqual({ ok: true, message: m });
  });

  it.each(toCsvHost.map((m, i) => [`${m.type} #${i}`, m] as const))('page → host %s', (_n, m) => {
    expect(decodeToCsvHost(JSON.parse(JSON.stringify(m)))).toEqual({ ok: true, message: m });
    expect(decodeToCsvHost(structuredClone(m))).toEqual({ ok: true, message: m });
  });

  const run = (value: unknown) => ({
    protocol: PROTOCOL_VERSION,
    type: 'csvRun',
    docVersion: 0,
    request: 1,
    run: value,
  });

  it.each([
    ['a csvReady with a version', { protocol: PROTOCOL_VERSION, type: 'csvReady', docVersion: 1 }],
    ['a csvReady from protocol 11', { protocol: 11, type: 'csvReady', docVersion: 0 }],
    ['an unknown action', run({ action: 'print', options: exportOptions })],
    ['save with import options', run({ action: 'save', options: importOptions })],
    ['createFile with export options', run({ action: 'createFile', options: exportOptions })],
    [
      'export options with "detect"',
      run({ action: 'copy', options: { ...exportOptions, delimiter: 'detect' } }),
    ],
    [
      'an unknown delimiter',
      run({ action: 'createFile', options: { ...importOptions, delimiter: ':' } }),
    ],
    ['a missing option', run({ action: 'save', options: { ...exportOptions, bom: undefined } })],
    ['a run without options', run({ action: 'save' })],
    ['a csvSource (host → page only)', toCsvPage[0]],
  ])('page → host: %s', (_why, data) => {
    const result = decodeToCsvHost(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });

  const outcome = (value: unknown) => ({ ...toCsvPage[2], outcome: value });
  const exportPage = toCsvPage[0] as CsvSourceMessage;
  it.each([
    ['done that is not true', outcome({ done: false })],
    ['an error with a fractional line', outcome({ error: { message: 'x', line: 1.5 } })],
    ['an error without a message', outcome({ error: { line: 1 } })],
    ['done and an error', outcome({ done: true, error: { message: 'x' } })],
    [
      'a source with an unknown mode',
      { ...exportPage, source: { ...exportPage.source, mode: 'merge' } },
    ],
    [
      'an export whose pointer is not a JSON Pointer',
      { ...exportPage, source: { ...exportPage.source, pointer: 'rows' } },
    ],
    [
      'an import without canReplace',
      { ...toCsvPage[1], source: { mode: 'import', name: 'a.csv', preview: '', complete: true } },
    ],
    ['a csvRun (page → host only)', toCsvHost[1]],
  ])('host → page: %s', (_why, data) => {
    const result = decodeToCsvPage(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });
});

// Spec 015 criterion 5 (015 T4, B5): a patch's values travel as JSON text, written by core's
// `valueText` and read by core's `parseData('json', …)`, as the webview and the host do.
describe('patch values (spec 015 criterion 5)', () => {
  const read = (text: string): unknown => {
    const result = parseData('json', text);
    if ('error' in result) throw new Error(result.error.message);
    return result.data;
  };
  /** The trip an edit takes: encoded, posted (JSON text and structured clone), decoded. */
  const trip = (change: DocumentChange) => {
    const message = {
      protocol: PROTOCOL_VERSION,
      type: 'edit',
      docVersion: 3,
      change: encodeChange(change, valueText),
    } as const;
    return [JSON.parse(JSON.stringify(message)) as unknown, structuredClone(message)].map(
      (data) => {
        const decoded = decodeToHost(data);
        if (!decoded.ok || decoded.message.type !== 'edit')
          throw new Error(JSON.stringify(decoded));
        return decodeChange(decoded.message.change, read);
      },
    );
  };
  const big = (digits: string) => new LosslessNumber(digits);
  const lookAlike = JSON.parse('{"isLosslessNumber": true, "value": "1"}') as object;
  const values: [string, unknown][] = [
    ['a big integer', big('12345678901234567890')],
    ['a big decimal', big('0.1000000000000000000001')],
    ['an overflowing number', big('1e400')],
    ['an underflowing number', big('-1E-400')],
    ['a plain number', 9007199254740991],
    ['a plain decimal', -1.5e-7],
    ['-0', -0],
    ['an object that looks like a big number', lookAlike],
    [
      'big numbers inside containers',
      { ids: [big('9007199254740993'), 5, -0, null, 'x'], nested: { a: big('-1e-400'), b: true } },
    ],
    ['a __proto__ key', JSON.parse('{"__proto__": {"x": 1}, "n": 1}') as unknown],
  ];

  it.each(values)('%s arrives as it left', (_name, value) => {
    const change: DocumentChange = {
      kind: 'patch',
      patch: [
        { op: 'add', path: '/a', value: value as never },
        { op: 'replace', path: '/b', value: value as never },
        { op: 'test', path: '/c', value: value as never },
        { op: 'remove', path: '/d' },
        { op: 'move', from: '/e', path: '/f' },
        { op: 'copy', from: '/g', path: '/h' },
      ],
    };
    for (const decoded of trip(change)) {
      expect(decoded).toStrictEqual(change);
      if (decoded.kind !== 'patch') throw new Error('not a patch');
      for (const op of decoded.patch.slice(0, 3)) {
        const got = (op as { value: unknown }).value;
        // toStrictEqual tells -0 from 0 and a LosslessNumber from a plain object.
        expect(got instanceof LosslessNumber).toBe(value instanceof LosslessNumber);
        if (value === lookAlike) expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
      }
    }
  });

  it('leaves text and action changes as they are', () => {
    const changes: DocumentChange[] = [
      { kind: 'text', text: '{"a": 12345678901234567890}' },
      { kind: 'action', action: { name: 'sort', path: '/ids', order: [1, 0] } },
    ];
    for (const change of changes)
      for (const decoded of trip(change)) expect(decoded).toEqual(change);
  });

  it('writes a value JSON has no text for so that the reader refuses it', () => {
    for (const value of [NaN, Infinity, -Infinity, [NaN]]) {
      const text = valueText(value);
      expect(() => read(text), text).toThrow();
    }
  });

  it('is version 15, and a receiver of another version rejects the message', () => {
    expect(PROTOCOL_VERSION).toBe(15);
    const edit = {
      protocol: PROTOCOL_VERSION,
      type: 'edit',
      docVersion: 1,
      change: encodeChange(
        { kind: 'patch', patch: [{ op: 'add', path: '/a', value: big('1e400') as never }] },
        valueText,
      ),
    };
    // A version 14 receiver checks `protocol` first; the version 14 shape (`value`) is refused here.
    expect(decodeToHost({ ...edit, protocol: 14 })).toMatchObject({ ok: false });
    expect(
      decodeToHost({
        ...edit,
        change: { kind: 'patch', patch: [{ op: 'add', path: '/a', value: 1 }] },
      }),
    ).toMatchObject({ ok: false });
  });
});
