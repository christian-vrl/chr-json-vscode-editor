// VscodeHostAdapter (003 T5): the webview's side of the protocol, over a fake webview API. The
// HostAdapter contract suite runs against it once the host applies edits (003 T5, document sync).
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@chr-json-editor/app-shell/protocol';
import { VscodeHostAdapter } from '../../src/webview/vscodeHostAdapter';

function fakeWebview() {
  const posted: unknown[] = [];
  let deliver: (data: unknown) => void = () => {};
  const adapter = new VscodeHostAdapter({ postMessage: (m) => posted.push(m) }, (listener) => {
    deliver = listener;
    return () => {};
  });
  return { adapter, posted, deliver: (data: unknown) => deliver(data) };
}

const init = {
  protocol: PROTOCOL_VERSION,
  type: 'init',
  docVersion: 4,
  text: '{}',
  format: 'jsonc',
  mode: 'tree',
  settings: { indent: 2 },
} as const;

describe('VscodeHostAdapter', () => {
  it('sends ready once and resolves open with the first init', async () => {
    const { adapter, posted, deliver } = fakeWebview();
    const opened = adapter.open();
    expect(adapter.open()).toBe(opened);
    expect(posted).toEqual([{ protocol: PROTOCOL_VERSION, type: 'ready', docVersion: 0 }]);
    deliver(init);
    deliver({ ...init, docVersion: 9, text: '[]' });
    await expect(opened).resolves.toEqual({
      docVersion: 4,
      text: '{}',
      format: 'jsonc',
      mode: 'tree',
      settings: { indent: 2 },
    });
    expect(adapter.getSettings()).toEqual({ indent: 2 });
  });

  it('has no settings before open resolves', () => {
    expect(() => fakeWebview().adapter.getSettings()).toThrow(/before open/);
  });

  it('passes host events to listeners, validation included (004 T5)', async () => {
    const { adapter, deliver } = fakeWebview();
    const events: unknown[] = [];
    const subscription = adapter.onExternalChange((e) => events.push(e));
    void adapter.open();
    deliver(init);
    const update = {
      protocol: PROTOCOL_VERSION,
      type: 'update',
      docVersion: 5,
      text: '[]',
      origin: 'external',
    };
    deliver(update);
    const validation = {
      protocol: PROTOCOL_VERSION,
      type: 'validation',
      docVersion: 5,
      dialect: { name: 'draft-07', assumed: true, switchable: true },
      result: { kind: 'errors', errors: [] },
    };
    deliver(validation);
    subscription.dispose();
    deliver({ ...update, docVersion: 6 });
    await Promise.resolve();
    expect(events).toEqual([update, validation]);
  });

  it('posts edits and notices as protocol messages', () => {
    const { adapter, posted } = fakeWebview();
    adapter.save(3, { kind: 'patch', patch: [{ op: 'remove', path: '/a' }] });
    adapter.showMessage({ docVersion: 3, code: 'x', message: 'shown' });
    adapter.setSchemaDialect(3, 'draft-04');
    expect(posted).toEqual([
      {
        protocol: PROTOCOL_VERSION,
        type: 'edit',
        docVersion: 3,
        change: { kind: 'patch', patch: [{ op: 'remove', path: '/a' }] },
      },
      { protocol: PROTOCOL_VERSION, type: 'error', docVersion: 3, code: 'x', message: 'shown' },
      { protocol: PROTOCOL_VERSION, type: 'setDialect', docVersion: 3, dialect: 'draft-04' },
    ]);
  });

  it('answers a message it cannot decode with a bad-message error', () => {
    const { posted, deliver } = fakeWebview();
    deliver({ protocol: 1, type: 'update', docVersion: 1, text: '' });
    expect(posted).toEqual([
      expect.objectContaining({ type: 'error', code: 'bad-message', docVersion: 0 }),
    ]);
  });
});
