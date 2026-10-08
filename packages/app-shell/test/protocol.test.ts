// Gate for 003 T1: every protocol message survives the trip a webview message takes (JSON text and
// structured clone) and decodes back to an equal value; malformed messages are rejected.
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  decodeToHost,
  decodeToWebview,
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
  { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 2, text: "{a: 'b'}" },
  { protocol: PROTOCOL_VERSION, type: 'setMode', docVersion: 2, mode: 'table' },
  { protocol: PROTOCOL_VERSION, type: 'setFormat', docVersion: 2, format: 'json5' },
  { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 3, code: 'stale', message: 'Edit on 2' },
];

const toHost: ToHostMessage[] = [
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

  it('covers every message type in the task (init, update, edit, setMode, setFormat, error)', () => {
    const types = new Set([...toWebview, ...toHost].map((m) => m.type));
    expect([...types].sort()).toEqual(
      ['edit', 'error', 'init', 'setFormat', 'setMode', 'update'].sort(),
    );
  });

  it('returns a fresh object, not the input', () => {
    const input = structuredClone(toWebview[1]);
    const result = decodeToWebview(input);
    expect(result.ok && result.message).not.toBe(input);
  });
});

describe('protocol rejects malformed messages', () => {
  const update = { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 1, text: 'x' };
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
    ['no protocol version', { type: 'update', docVersion: 1, text: 'x' }],
    ['an unknown type', { ...update, type: 'save' }],
    ['a direction it cannot travel', edit],
    ['no docVersion', { protocol: PROTOCOL_VERSION, type: 'update', text: 'x' }],
    ['a negative docVersion', { ...update, docVersion: -1 }],
    ['a fractional docVersion', { ...update, docVersion: 1.5 }],
    ['a string docVersion', { ...update, docVersion: '1' }],
    ['a non-string text', { ...update, text: 1 }],
    ['an extra property', { ...update, extra: true }],
    ['an unknown mode', { protocol: 1, type: 'setMode', docVersion: 1, mode: 'graph' }],
    ['an unknown format', { protocol: 1, type: 'setFormat', docVersion: 1, format: 'yaml' }],
    ['an error without code', { protocol: 1, type: 'error', docVersion: 1, message: 'm' }],
    [
      'init settings that are not JSON',
      { ...toWebview[0], settings: { f: Number.NaN } } as unknown,
    ],
  ])('host → webview: %s', (_why, data) => {
    const result = decodeToWebview(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });

  const patchEdit = (patch: unknown) => ({ ...edit, change: { kind: 'patch', patch } });

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
  ])('webview → host: %s', (_why, data) => {
    const result = decodeToHost(data);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\S/);
  });
});
