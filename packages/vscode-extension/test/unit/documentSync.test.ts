// DocumentSync (003 T5): the host side of document sync, over an in-memory document. The
// HostAdapter contract suite (app-shell, 003 T1 review F6) runs against VscodeHostAdapter wired to
// it the way editorProvider.ts wires them through a webview (003 T2 review carry-forward).
import { describe, expect, it } from 'vitest';
import {
  decodeToHost,
  DEFAULT_EDITOR_SETTINGS,
  decodeToWebview,
  encodeChange,
  PROTOCOL_VERSION,
  type DocumentChange,
  type ToWebviewMessage,
} from '@chr-json-editor/app-shell/protocol';
import {
  LosslessNumber,
  valueText,
  type Format,
  type SmartFormatOptions,
} from '@chr-json-editor/core';
import { describeHostAdapterContract } from '../../../app-shell/test/host-adapter-contract';
import { DocumentSync, minimalReplacement } from '../../src/documentSync';
import { JSONL_MESSAGE } from '../../src/smartFormatPlan';
import { VscodeHostAdapter } from '../../src/webview/vscodeHostAdapter';

/** A document like VS Code's: each replacement bumps the version and fires a change event. */
function memoryDocument(initial: string, format: Format = 'json') {
  let text = initial;
  let version = 1;
  const posted: ToWebviewMessage[] = [];
  // The document's history, like VS Code's: every change can be undone, an undo can be redone.
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const step = (from: string[], to: string[]) => {
    const previous = from.pop();
    if (previous === undefined) return;
    to.push(text);
    text = previous;
    version++;
    doc.sync.changed();
  };
  const doc = {
    posted,
    refuse: false,
    /** The answer to a repair that removes comments, and the comments each question named. */
    confirm: (() => Promise.resolve(true)) as (lostComments: readonly string[]) => Promise<boolean>,
    asked: [] as (readonly string[])[],
    /** Smart Format's options, read at each run (spec 019 F1). */
    smartFormatOptions: {} as SmartFormatOptions,
    get text() {
      return text;
    },
    get version() {
      return version;
    },
    sync: undefined as unknown as DocumentSync,
    /** Every undo and redo the sync ran, oldest first. */
    historyRun: [] as ('undo' | 'redo')[],
    onPost: (() => {}) as (message: ToWebviewMessage) => void,
    /** Another editor's change. */
    externalChange(next: string) {
      undoStack.push(text);
      redoStack.length = 0;
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
    history: (action) => {
      doc.historyRun.push(action);
      if (action === 'undo') step(undoStack, redoStack);
      else step(redoStack, undoStack);
      return Promise.resolve();
    },
    post: (message) => {
      posted.push(message);
      doc.onPost(message);
    },
    confirmRepair: (lostComments) => {
      doc.asked.push(lostComments);
      return doc.confirm(lostComments);
    },
    smartFormatOptions: () => doc.smartFormatOptions,
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
            settings: { ...DEFAULT_EDITOR_SETTINGS },
            largeFile: null,
          });
        } else if (message.type === 'edit') {
          void doc.sync.edit(message);
        } else if (message.type === 'undo' || message.type === 'redo') {
          void doc.sync.history(message.type);
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

/** An `edit` as the webview sends it: patch values as JSON text (protocol 15, spec 015 B5). */
const edit = (docVersion: number, change: DocumentChange) =>
  ({
    protocol: PROTOCOL_VERSION,
    type: 'edit',
    docVersion,
    change: encodeChange(change, valueText),
  }) as const;

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

  // Spec 015 B5: a patch value arrives as JSON text, read with core, big numbers exactly.
  it('applies a patch value holding a big number and a look-alike object exactly', async () => {
    const doc = memoryDocument('{"a": 1}\n', 'json');
    const value = JSON.parse(
      '{"big": 0, "neg": 0, "like": {"isLosslessNumber": true, "value": "1"}}',
    ) as Record<string, unknown>;
    value.big = new LosslessNumber('98765432109876543210');
    value.neg = -0;
    await doc.sync.edit(edit(1, { kind: 'patch', patch: [{ op: 'replace', path: '/a', value }] }));
    // JSON writes -0 as 0, as JSON.stringify does (002 R8); the big number keeps its digits.
    expect(doc.text).toBe(
      '{"a": {"big":98765432109876543210,"neg":0,"like":{"isLosslessNumber":true,"value":"1"}}}\n',
    );
  });

  it('answers a patch value that is not JSON with patch-failed', async () => {
    const doc = memoryDocument('{"a": 1}\n', 'json');
    await doc.sync.edit({
      protocol: PROTOCOL_VERSION,
      type: 'edit',
      docVersion: 1,
      change: { kind: 'patch', patch: [{ op: 'replace', path: '/a', valueText: 'NaN' }] },
    });
    expect(doc.text).toBe('{"a": 1}\n');
    expect(doc.posted).toEqual([expect.objectContaining({ type: 'error', code: 'patch-failed' })]);
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

describe('DocumentSync actions (003 T8)', () => {
  const LOSSY = '{\n  "a": "x" + // between\n    "y",\n  "b": 1 // kept\n}\n';

  it('runs core on the text and writes the result as one change', async () => {
    const doc = memoryDocument('// c\n{\n  "b": 1, // x\n  "a": 2\n}\n', 'jsonc');
    await doc.sync.edit(
      edit(1, { kind: 'action', action: { name: 'sort', path: '', order: [1, 0] } }),
    );
    expect(doc.text).toBe('// c\n{\n  "a": 2,\n  "b": 1 // x\n}\n');
    expect(doc.version).toBe(2);
    await doc.sync.edit(edit(2, { kind: 'action', action: { name: 'compact' } }));
    expect(doc.text).toBe('/* c */{"a":2,"b":1/* x */}\n');
    expect(doc.posted.map((m) => m.type)).toEqual(['update', 'update']);
  });

  it('repairs without asking when every comment is kept', async () => {
    const doc = memoryDocument('{"a": 1 // one\n "b": 2}', 'jsonc');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repair' } }));
    expect(doc.text).toBe('{"a": 1, // one\n "b": 2}');
    expect(doc.asked).toEqual([]);
  });

  it('asks before a repair that removes a comment, and leaves the text when declined', async () => {
    const doc = memoryDocument(LOSSY, 'jsonc');
    doc.confirm = () => Promise.resolve(false);
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repair' } }));
    expect(doc.asked).toEqual([['// between']]);
    expect(doc.text).toBe(LOSSY);
    expect(doc.posted).toEqual([
      { protocol: PROTOCOL_VERSION, type: 'update', docVersion: 1, text: LOSSY, origin: 'edit' },
    ]);
    doc.confirm = () => Promise.resolve(true);
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repair' } }));
    expect(doc.text).toBe('{\n  "a": "xy",\n  "b": 1 // kept\n}\n');
  });

  it('drops a repair when the document changed while the user was asked', async () => {
    const doc = memoryDocument(LOSSY, 'jsonc');
    doc.confirm = () => {
      doc.externalChange('{}');
      return Promise.resolve(true);
    };
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repair' } }));
    expect(doc.text).toBe('{}');
    expect(doc.posted.at(-1)).toMatchObject({ type: 'error', code: 'stale-edit' });
  });

  it('runs Repair Lines on a JSON Lines document as one edit (spec 012 L10)', async () => {
    const doc = memoryDocument('{"a":1}\n{"b":\n2}\n3\n{c\n', 'jsonl');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repairLines' } }));
    expect(doc.text).toBe('{"a":1}\n{"b":2}\n3\n{"c":null}\n');
    expect(doc.posted).toEqual([expect.objectContaining({ type: 'update', origin: 'edit' })]);
  });

  it('answers an action core refuses with patch-failed', async () => {
    const doc = memoryDocument('{"a": +Infinity}', 'jsonc');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'repair' } }));
    expect(doc.posted).toEqual([expect.objectContaining({ type: 'error', code: 'patch-failed' })]);
  });
});

describe('DocumentSync smart format (010 T3)', () => {
  const INPUT = '{\n  "a": [\n    1,\n    2\n  ], // two\n  "b": {"c": 3},\n}\n';

  it('runs core smartFormat as one change, and answers an already formatted text without one', async () => {
    const doc = memoryDocument(INPUT, 'jsonc');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.text).toBe('{\n  "a": [1, 2],  // two\n  "b": {"c": 3},\n}\n');
    expect(doc.version).toBe(2);
    await doc.sync.edit(edit(2, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.version).toBe(2);
    expect(doc.posted.map((m) => m.type)).toEqual(['update', 'update']);
  });

  it('lays out to the line length read when the action runs (spec 019 F1)', async () => {
    const doc = memoryDocument(INPUT, 'jsonc');
    doc.smartFormatOptions = { maxLineLength: 20 };
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.text).toBe('{\n  "a": [\n    1,\n    2\n  ],  // two\n  "b": {"c": 3},\n}\n');
    doc.smartFormatOptions = { maxLineLength: 25 };
    await doc.sync.edit(edit(2, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.text).toBe('{\n  "a": [1, 2],  // two\n  "b": {"c": 3},\n}\n');
  });

  it("answers a document that does not parse with criterion 9's message", async () => {
    const doc = memoryDocument('{"a": [1, 2,\n"b": 3}', 'json5');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.posted).toEqual([
      expect.objectContaining({
        type: 'error',
        code: 'patch-failed',
        message: 'Smart Format needs valid JSON5. Fix the errors or run Repair JSON first.',
      }),
    ]);
  });

  it('refuses a JSON Lines document (spec 010 §Scope)', async () => {
    const doc = memoryDocument('{"a": [\n1]}\n', 'jsonl');
    await doc.sync.edit(edit(1, { kind: 'action', action: { name: 'smartFormat' } }));
    expect(doc.text).toBe('{"a": [\n1]}\n');
    expect(doc.posted).toEqual([
      expect.objectContaining({ type: 'error', code: 'patch-failed', message: JSONL_MESSAGE }),
    ]);
  });
});

describe('DocumentSync history (003 T7)', () => {
  it('runs undo after the edits received before it, and reports it as external', async () => {
    const doc = memoryDocument('[]');
    const first = doc.sync.edit(edit(1, { kind: 'text', text: '[1]' }));
    const undo = doc.sync.history('undo');
    expect(doc.historyRun).toEqual([]);
    await first;
    await undo;
    expect(doc.historyRun).toEqual(['undo']);
    expect(doc.text).toBe('[]');
    expect(doc.posted.map((m) => m.type === 'update' && [m.origin, m.text])).toEqual([
      ['edit', '[1]'],
      ['external', '[]'],
    ]);
  });

  it('runs redo in order with edits after it', async () => {
    const doc = memoryDocument('[]');
    await doc.sync.edit(edit(1, { kind: 'text', text: '[1]' }));
    await doc.sync.history('undo');
    await doc.sync.history('redo');
    await doc.sync.edit(edit(4, { kind: 'text', text: '[1, 2]' }));
    expect(doc.historyRun).toEqual(['undo', 'redo']);
    expect(doc.text).toBe('[1, 2]');
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
