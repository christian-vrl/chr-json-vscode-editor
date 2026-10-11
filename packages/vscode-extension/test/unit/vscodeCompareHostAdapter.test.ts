// VscodeCompareHostAdapter (007 T4): the compare page's side of the compare messages, over a fake
// webview API. It parses each side's text with the parser it is given (the editor's, in the
// webview), so JSON5 values survive the trip.
import { describe, expect, it } from 'vitest';
import { getAdapter, type Format } from '@chr-json-editor/core';
import { PROTOCOL_VERSION, type CompareMessage } from '@chr-json-editor/app-shell/protocol';
import { VscodeCompareHostAdapter } from '../../src/webview/vscodeCompareHostAdapter';

function parse(text: string, format: Format): unknown {
  const result = getAdapter(format).parse(text);
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error) throw new SyntaxError(error.message);
  return result.data;
}

function fakeWebview() {
  const posted: unknown[] = [];
  let deliver: (data: unknown) => void = () => {};
  const adapter = new VscodeCompareHostAdapter(
    { postMessage: (m) => posted.push(m) },
    (listener) => {
      deliver = listener;
      return () => {};
    },
    parse,
  );
  return { adapter, posted, deliver: (data: unknown) => deliver(data) };
}

const message: CompareMessage = {
  protocol: PROTOCOL_VERSION,
  type: 'compare',
  docVersion: 3,
  left: {
    name: 'a.json5 (HEAD)',
    format: 'json5',
    content: { kind: 'text', text: '{a: NaN, b: [1]}' },
    writable: false,
  },
  right: {
    name: 'a.json5',
    format: 'json5',
    content: { kind: 'text', text: '{a: NaN, b: [1, 2]} // edited' },
    writable: true,
  },
  differences: [{ kind: 'added', rightPath: '/b/1' }],
};

describe('VscodeCompareHostAdapter', () => {
  it('sends compareReady once and resolves open with the first compare, parsed', async () => {
    const { adapter, posted, deliver } = fakeWebview();
    const opened = adapter.open();
    expect(adapter.open()).toBe(opened);
    expect(posted).toEqual([{ protocol: PROTOCOL_VERSION, type: 'compareReady', docVersion: 0 }]);
    deliver(message);
    await expect(opened).resolves.toEqual({
      version: 3,
      left: {
        name: 'a.json5 (HEAD)',
        format: 'json5',
        content: { kind: 'data', data: { a: NaN, b: [1] } },
        writable: false,
      },
      right: {
        name: 'a.json5',
        format: 'json5',
        content: { kind: 'data', data: { a: NaN, b: [1, 2] } },
        writable: true,
      },
      differences: [{ kind: 'added', rightPath: '/b/1' }],
    });
  });

  it('passes later compares to onUpdate and reports a side that fails to parse', async () => {
    const { adapter, deliver } = fakeWebview();
    const opened = adapter.open();
    deliver(message);
    await opened;
    const states: unknown[] = [];
    adapter.onUpdate((s) => states.push(s));
    deliver({
      ...message,
      docVersion: 4,
      right: { ...message.right, content: { kind: 'text', text: '{' } },
    });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      version: 4,
      right: { content: { kind: 'error' } },
      differences: [],
    });
  });

  it('posts copies and notices, and reports a message it cannot decode', () => {
    const { adapter, posted, deliver } = fakeWebview();
    void adapter.open();
    adapter.copy(3, { kind: 'changed', leftPath: '/a', rightPath: '/a' }, 'left');
    adapter.showMessage({ code: 'c', message: 'm' });
    deliver({ ...message, protocol: 9 });
    expect(posted.slice(1)).toEqual([
      {
        protocol: PROTOCOL_VERSION,
        type: 'copy',
        docVersion: 3,
        difference: { kind: 'changed', leftPath: '/a', rightPath: '/a' },
        to: 'left',
      },
      { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 0, code: 'c', message: 'm' },
      expect.objectContaining({ type: 'error', code: 'bad-message' }),
    ]);
    expect(() => adapter.copy(3, { kind: 'added' }, 'left')).toThrow(/without its paths/);
  });
});
