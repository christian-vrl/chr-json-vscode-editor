// DocumentSync (003 T5): the host side of document sync, over an in-memory document. The
// HostAdapter contract suite (app-shell, 003 T1 review F6) runs against VscodeHostAdapter wired to
// it the way editorProvider.ts wires them through a webview (003 T2 review carry-forward).
import { describe, expect, it } from 'vitest';
import {
  decodeToHost,
  decodeToWebview,
  PROTOCOL_VERSION,
  type ToWebviewMessage,
} from '@chr-json-editor/app-shell/protocol';
import type { Format } from '@chr-json-editor/core';
import { describeHostAdapterContract } from '../../../app-shell/test/host-adapter-contract';
import { DocumentSync, minimalReplacement } from '../../src/documentSync';
import { VscodeHostAdapter } from '../../src/webview/vscodeHostAdapter';

/** A document like VS Code's: each replacement bumps the version and fires a change event. */
function memoryDocument(initial: string, format: Format = 'json') {
  let text = initial;
  let version = 1;
  const posted: ToWebviewMessage[] = [];
  const doc = {
    posted,
    refuse: false,
    get text() {
      return text;
    },
    get version() {
      return version;
    },
    sync: undefined as unknown as DocumentSync,
    onPost: (() => {}) as (message: ToWebviewMessage) => void,
    /** Another editor's change. */
    externalChange(next: string) {
      text = next;
      version++;
      doc.sync.changed();
    },
  };
  doc.sync = new DocumentSync({
    text: () => text,
    version: () => version,
    format: () => format,
    replace: (next) => {
      if (doc.refuse) return Promise.resolve(false);
      doc.externalChange(next);
      return Promise.resolve(true);
    },
    post: (message) => {
      posted.push(message);
      doc.onPost(message);
    },
  });
  return doc;
}

describeHostAdapterContract('VscodeHostAdapter over DocumentSync', (text) => {
  const doc = memoryDocument(text);
  let deliver: (data: unknown) => void = () => {};
  // postMessage delivers a structured clone, never synchronously.
  const send = (message: unknown) => {
    const copy = structuredClone(message);
    setTimeout(() => deliver(copy), 0);
  };
  doc.onPost = send;
  const adapter = new VscodeHostAdapter(
    {
      postMessage(data) {
        const decoded = decodeToHost(structuredClone(data));
        if (!decoded.ok) throw new Error(decoded.error);
        const message = decoded.message;
        // What editorProvider.ts does with each message.
        if (message.type === 'ready') {
          send({
            protocol: PROTOCOL_VERSION,
            type: 'init',
            docVersion: doc.version,
            text: doc.text,
            format: 'json',
            mode: 'tree',
            settings: {},
          });
        } else if (message.type === 'edit') {
          void doc.sync.edit(message);
        }
      },
    },
    (listener) => {
      deliver = listener;
      return () => {};
    },
  );
  return { adapter, externalChange: (next) => doc.externalChange(next) };
});

const edit = (docVersion: number, change: Parameters<DocumentSync['edit']>[0]['change']) =>
  ({ protocol: PROTOCOL_VERSION, type: 'edit', docVersion, change }) as const;

describe('DocumentSync', () => {
  it('applies a patch with core, keeping comments and style', async () => {
    const doc = memoryDocument('{\n  // keep\n  "a": 1, // one\n}\n', 'jsonc');
    await doc.sync.edit(
      edit(1, { kind: 'patch', patch: [{ op: 'replace', path: '/a', value: 2 }] }),
    );
    expect(doc.text).toBe('{\n  // keep\n  "a": 2, // one\n}\n');
    expect(doc.posted).toEqual([
      { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 2, text: doc.text, origin: 'edit' },
    ]);
  });

  it('answers an edit that changes nothing without touching the document', async () => {
    const doc = memoryDocument('[1]');
    await doc.sync.edit(edit(1, { kind: 'text', text: '[1]' }));
    expect(doc.version).toBe(1);
    expect(doc.posted).toEqual([
      { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 1, text: '[1]', origin: 'edit' },
    ]);
  });

  it('answers a refused edit with edit-failed', async () => {
    const doc = memoryDocument('[1]');
    doc.refuse = true;
    await doc.sync.edit(edit(1, { kind: 'text', text: '[2]' }));
    expect(doc.text).toBe('[1]');
    expect(doc.posted).toMatchObject([{ type: 'error', code: 'edit-failed', docVersion: 1 }]);
  });

  it('calls a change with other text external, even while an edit is applied', () => {
    const doc = memoryDocument('[1]');
    void doc.sync.edit(edit(1, { kind: 'text', text: '[2]' }));
    doc.externalChange('[3]');
    expect(doc.posted).toMatchObject([{ type: 'update', text: '[3]', origin: 'external' }]);
  });

  it('applies queued edits in order, each on the text the previous one left', async () => {
    const doc = memoryDocument('[]');
    const first = doc.sync.edit(
      edit(1, { kind: 'patch', patch: [{ op: 'add', path: '/-', value: 1 }] }),
    );
    const second = doc.sync.edit(
      edit(2, { kind: 'patch', patch: [{ op: 'add', path: '/-', value: 2 }] }),
    );
    await Promise.all([first, second]);
    expect(doc.text).toBe('[1, 2]');
    expect(doc.posted.map((m) => m.type === 'update' && m.origin)).toEqual(['edit', 'edit']);
    for (const message of doc.posted) expect(decodeToWebview(message).ok).toBe(true);
  });

  it('applies a JSON5 patch on a document with no value (spec 002 R15)', async () => {
    const doc = memoryDocument('// empty\n', 'json5');
    await doc.sync.edit(
      edit(1, { kind: 'patch', patch: [{ op: 'add', path: '', value: { a: 1 } }] }),
    );
    expect(doc.posted).toMatchObject([{ type: 'update', origin: 'edit' }]);
    expect(doc.text).toContain('// empty');
  });
});

describe('minimalReplacement', () => {
  it.each([
    ['abc', 'abc', { start: 3, end: 3, text: '' }],
    ['abc', 'abXc', { start: 2, end: 2, text: 'X' }],
    ['a1b', 'a22b', { start: 1, end: 2, text: '22' }],
    ['', 'x', { start: 0, end: 0, text: 'x' }],
    ['aaa', 'aa', { start: 2, end: 3, text: '' }],
    // CRLF and surrogate pairs are never split.
    ['a\r\nb', 'a\nb', { start: 1, end: 3, text: '\n' }],
    ['x\r\ny', 'x\r\r\ny', { start: 1, end: 3, text: '\r\r\n' }],
    ['😀', '😁', { start: 0, end: 2, text: '😁' }],
  ])('%j → %j', (before, after, expected) => {
    const r = minimalReplacement(before, after);
    expect(r).toEqual(expected);
    expect(before.slice(0, r.start) + r.text + before.slice(r.end)).toBe(after);
  });
});
