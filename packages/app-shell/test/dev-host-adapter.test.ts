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
    await expect.poll(() => events).toMatchObject([{ type: 'error', code: 'edit-failed' }]);
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

  it('refuses getSettings before open', () => {
    const host = new DevHostAdapter({ text: '{}', format: 'json', mode: 'tree' });
    expect(() => host.getSettings()).toThrow(/before open/);
  });
});
