// The HostAdapter contract (003 T1 review F6): behaviour every host's adapter must show, written
// once and run against each adapter. DevHostAdapter runs it in dev-host-adapter.test.ts;
// VscodeHostAdapter (003 T4/T5) and ChromeHostAdapter run the same suite with their own harness.
import { describe, expect, it } from 'vitest';
import type { HostAdapter, HostEvent } from '../src/host-adapter.js';
import { decodeToWebview, PROTOCOL_VERSION } from '../src/protocol.js';

/** What a harness provides: a fresh adapter over `text`, and a way to change the document outside the UI. */
export interface ContractHarness {
  adapter: HostAdapter;
  /** Changes the document the way another editor would. */
  externalChange(text: string): void | Promise<void>;
}

const TEXT = '{\n  "a": 1\n}\n';

/** Collects host events and waits for them; delivery may be asynchronous, like postMessage. */
function recorder(adapter: HostAdapter) {
  const events: HostEvent[] = [];
  const subscription = adapter.onExternalChange((event) => events.push(event));
  return {
    events,
    subscription,
    async next(count = 1): Promise<HostEvent[]> {
      await expect.poll(() => events.length).toBeGreaterThanOrEqual(count);
      return events.splice(0, count);
    },
  };
}

/** Lets pending deliveries land, so a test can assert that nothing arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

export function describeHostAdapterContract(
  name: string,
  create: (text: string) => ContractHarness | Promise<ContractHarness>,
): void {
  describe(`HostAdapter contract: ${name}`, () => {
    it('open resolves with a document that is a valid init message', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      expect(doc.text).toBe(TEXT);
      const decoded = decodeToWebview({ protocol: PROTOCOL_VERSION, type: 'init', ...doc });
      expect(decoded).toEqual({
        ok: true,
        message: { protocol: PROTOCOL_VERSION, type: 'init', ...doc },
      });
    });

    it('getSettings returns the settings that came with open', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      expect(adapter.getSettings()).toEqual(doc.settings);
    });

    it('a text change on the current version comes back as an update with a newer version', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.save(doc.docVersion, { kind: 'text', text: '{"a": 2}' });
      const [event] = await rec.next();
      expect(event).toMatchObject({ type: 'update', text: '{"a": 2}', origin: 'edit' });
      expect(event!.docVersion).toBeGreaterThan(doc.docVersion);
    });

    it('a patch on the current version comes back as an update holding the patched data', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.save(doc.docVersion, {
        kind: 'patch',
        patch: [{ op: 'replace', path: '/a', value: 3 }],
      });
      const [event] = await rec.next();
      expect(event).toMatchObject({ type: 'update', origin: 'edit' });
      expect(JSON.parse((event as Extract<HostEvent, { type: 'update' }>).text)).toEqual({ a: 3 });
      expect(event!.docVersion).toBeGreaterThan(doc.docVersion);
    });

    it('a change on a stale version is answered with an error and leaves the document alone', async () => {
      const harness = await create(TEXT);
      const { adapter } = harness;
      const doc = await adapter.open();
      const rec = recorder(adapter);
      await harness.externalChange('{"b": 1}');
      const [update] = await rec.next();
      adapter.save(doc.docVersion, { kind: 'text', text: '{"stale": true}' });
      const [error] = await rec.next();
      expect(error).toMatchObject({
        type: 'error',
        code: 'stale-edit',
        docVersion: update!.docVersion,
      });
      await settle();
      expect(rec.events).toEqual([]);
    });

    it('answers each of two edits on the same version: the second one is stale', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.save(doc.docVersion, { kind: 'text', text: '[1]' });
      adapter.save(doc.docVersion, { kind: 'text', text: '[2]' });
      const [first, second] = await rec.next(2);
      expect(first).toMatchObject({ type: 'update', origin: 'edit', text: '[1]' });
      expect(second).toMatchObject({
        type: 'error',
        code: 'stale-edit',
        docVersion: first!.docVersion,
      });
    });

    it('answers a patch that does not apply with patch-failed and keeps the text', async () => {
      const harness = await create(TEXT);
      const doc = await harness.adapter.open();
      const rec = recorder(harness.adapter);
      harness.adapter.save(doc.docVersion, {
        kind: 'patch',
        patch: [{ op: 'test', path: '/a', value: 99 }],
      });
      const [error] = await rec.next();
      expect(error).toMatchObject({
        type: 'error',
        code: 'patch-failed',
        docVersion: doc.docVersion,
      });
      await settle();
      expect(rec.events).toEqual([]);
    });

    it('an external change arrives as an update with a newer version', async () => {
      const harness = await create(TEXT);
      const doc = await harness.adapter.open();
      const rec = recorder(harness.adapter);
      await harness.externalChange('[1, 2]');
      const [event] = await rec.next();
      expect(event).toMatchObject({ type: 'update', text: '[1, 2]', origin: 'external' });
      expect(event!.docVersion).toBeGreaterThan(doc.docVersion);
    });

    it('every event is a message decodeToWebview accepts unchanged', async () => {
      const harness = await create(TEXT);
      const doc = await harness.adapter.open();
      const rec = recorder(harness.adapter);
      await harness.externalChange('[]');
      harness.adapter.save(doc.docVersion, { kind: 'text', text: 'stale' });
      for (const event of await rec.next(2)) {
        expect(decodeToWebview(event)).toEqual({ ok: true, message: event });
      }
    });

    it('a disposed listener gets no more events', async () => {
      const harness = await create(TEXT);
      await harness.adapter.open();
      const rec = recorder(harness.adapter);
      rec.subscription.dispose();
      await harness.externalChange('[]');
      await settle();
      expect(rec.events).toEqual([]);
    });

    it('showMessage accepts a notice without throwing', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      expect(() =>
        adapter.showMessage({ docVersion: doc.docVersion, code: 'test', message: 'shown' }),
      ).not.toThrow();
    });

    it('undo brings back the text before a change and redo the change, as external updates (003 T7)', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.save(doc.docVersion, { kind: 'text', text: '[1]' });
      const [edited] = await rec.next();
      expect(edited).toMatchObject({ type: 'update', origin: 'edit', text: '[1]' });
      adapter.undo(edited!.docVersion);
      const [undone] = await rec.next();
      expect(undone).toMatchObject({ type: 'update', origin: 'external', text: TEXT });
      expect(undone!.docVersion).toBeGreaterThan(edited!.docVersion);
      adapter.redo(undone!.docVersion);
      const [redone] = await rec.next();
      expect(redone).toMatchObject({ type: 'update', origin: 'external', text: '[1]' });
      expect(redone!.docVersion).toBeGreaterThan(undone!.docVersion);
    });

    it('undo after an edit sent just before it undoes that edit (003 T7)', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.save(doc.docVersion, { kind: 'text', text: '[1]' });
      adapter.undo(doc.docVersion);
      const [edited, undone] = await rec.next(2);
      expect(edited).toMatchObject({ type: 'update', origin: 'edit', text: '[1]' });
      expect(undone).toMatchObject({ type: 'update', origin: 'external', text: TEXT });
    });

    it('undo with nothing to undo changes nothing and sends nothing (003 T7)', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      const rec = recorder(adapter);
      adapter.undo(doc.docVersion);
      adapter.redo(doc.docVersion);
      await settle();
      expect(rec.events).toEqual([]);
    });

    it('flushed accepts an answer without throwing (003 T7)', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      expect(() => adapter.flushed(doc.docVersion, 1)).not.toThrow();
    });

    it('setSchemaDialect accepts a dialect without throwing (004 T5)', async () => {
      const { adapter } = await create(TEXT);
      const doc = await adapter.open();
      expect(() => adapter.setSchemaDialect(doc.docVersion, 'draft-04')).not.toThrow();
    });
  });
}
