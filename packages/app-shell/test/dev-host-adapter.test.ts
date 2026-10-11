// DevHostAdapter (003 T2): the HostAdapter contract, plus the host-side controls the standalone
// page and test:web use.
import { describe, expect, it } from 'vitest';
import { DevHostAdapter } from '../src/dev-host-adapter.js';
import { describeHostAdapterContract } from './host-adapter-contract.js';

describeHostAdapterContract('DevHostAdapter', (text) => {
  const adapter = new DevHostAdapter({ text, format: 'json', mode: 'tree' });
  return { adapter, externalChange: (next) => adapter.externalChange(next) };
});

describe('DevHostAdapter', () => {
  it('keeps the text a change produced and records every change it received', async () => {
    const host = new DevHostAdapter({ text: '[]', format: 'json', mode: 'text' });
    const doc = await host.open();
    host.save(doc.docVersion, { kind: 'text', text: '[1]' });
    host.save(doc.docVersion, { kind: 'text', text: '[2]' });
    expect(host.text).toBe('[1]');
    expect(host.docVersion).toBe(doc.docVersion + 1);
    expect(host.edits).toEqual([
      { docVersion: doc.docVersion, change: { kind: 'text', text: '[1]' } },
      { docVersion: doc.docVersion, change: { kind: 'text', text: '[2]' } },
    ]);
  });

  it('answers a patch that does not apply with an error and keeps the text', async () => {
    const host = new DevHostAdapter({ text: '{}', format: 'json', mode: 'tree' });
    const doc = await host.open();
    const events: unknown[] = [];
    host.onExternalChange((e) => events.push(e));
    host.save(doc.docVersion, {
      kind: 'patch',
      patch: [{ op: 'test', path: '/missing', value: 1 }],
    });
    await expect.poll(() => events).toMatchObject([{ type: 'error', code: 'patch-failed' }]);
    expect(host.text).toBe('{}');
  });

  it('sends setMode and setFormat without changing the document', async () => {
    const host = new DevHostAdapter({ text: '{}', format: 'json', mode: 'tree' });
    const doc = await host.open();
    const events: unknown[] = [];
    host.onExternalChange((e) => events.push(e));
    host.setMode('table');
    host.setFormat('json5');
    await expect
      .poll(() => events)
      .toMatchObject([
        { type: 'setMode', mode: 'table', docVersion: doc.docVersion },
        { type: 'setFormat', format: 'json5', docVersion: doc.docVersion },
      ]);
    expect(host.text).toBe('{}');
  });

  it('a locked large file refuses changes, undo and redo until unlocked (spec 008)', async () => {
    const largeFile = { bytes: 6_291_456, unlocked: false };
    const host = new DevHostAdapter({ text: '{"a": 1}', format: 'json', mode: 'tree', largeFile });
    const doc = await host.open();
    expect(doc.largeFile).toEqual(largeFile);
    const events: unknown[] = [];
    host.onExternalChange((e) => events.push(e));
    host.save(doc.docVersion, { kind: 'text', text: '{}' });
    host.undo();
    await expect.poll(() => events).toMatchObject([{ type: 'error', code: 'read-only' }]);
    expect(host.text).toBe('{"a": 1}');
    expect(host.docVersion).toBe(doc.docVersion);

    host.openAsText();
    host.unlock();
    expect(host.banner).toEqual(['openAsText', 'unlock']);
    expect(host.largeFile).toEqual({ bytes: 6_291_456, unlocked: true });
    expect((await host.open()).largeFile).toEqual({ bytes: 6_291_456, unlocked: true });
    host.save(doc.docVersion, { kind: 'text', text: '{}' });
    expect(host.text).toBe('{}');
  });

  it('opens the normal editor without a largeFile', async () => {
    const host = new DevHostAdapter({ text: '{}', format: 'json', mode: 'tree' });
    expect((await host.open()).largeFile).toBeNull();
    host.unlock();
    expect(host.largeFile).toBeNull();
  });

  it('refuses getSettings before open', () => {
    const host = new DevHostAdapter({ text: '{}', format: 'json', mode: 'tree' });
    expect(() => host.getSettings()).toThrow(/before open/);
  });
});
