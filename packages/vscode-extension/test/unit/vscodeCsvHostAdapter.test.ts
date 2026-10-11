// VscodeCsvHostAdapter (009 T4): the CSV page's side of the CSV messages, over a fake webview API.
// An export preview arrives as JSON5 text and is read back with NaN, Infinity and -0 kept.
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@chr-json-editor/app-shell/protocol';
import { VscodeCsvHostAdapter } from '../../src/webview/vscodeCsvHostAdapter';

function fakeWebview() {
  const posted: unknown[] = [];
  let deliver: (data: unknown) => void = () => {};
  const adapter = new VscodeCsvHostAdapter({ postMessage: (m) => posted.push(m) }, (listener) => {
    deliver = listener;
    return () => {};
  });
  return { adapter, posted, deliver: (data: unknown) => deliver(data) };
}

const envelope = { protocol: PROTOCOL_VERSION, docVersion: 0 } as const;

describe('VscodeCsvHostAdapter', () => {
  it('sends csvReady once and resolves open with the source, the preview read as JSON5', async () => {
    const { adapter, posted, deliver } = fakeWebview();
    const opened = adapter.open();
    expect(adapter.open()).toBe(opened);
    expect(posted).toEqual([{ ...envelope, type: 'csvReady' }]);
    deliver({
      ...envelope,
      type: 'csvSource',
      source: {
        mode: 'export',
        name: 'a.json5',
        pointer: '',
        preview: '[{a:NaN,b:-0,c:Infinity}]',
        rowCount: 1,
      },
    });
    const source = await opened;
    expect(source).toMatchObject({ mode: 'export', name: 'a.json5', pointer: '', rowCount: 1 });
    const [row] = (source.mode === 'export' ? source.preview : []) as {
      a: number;
      b: number;
      c: number;
    }[];
    expect(Number.isNaN(row!.a)).toBe(true);
    expect(Object.is(row!.b, -0)).toBe(true);
    expect(row!.c).toBe(Infinity);
  });

  it('passes an import source as it is', async () => {
    const { adapter, deliver } = fakeWebview();
    const opened = adapter.open();
    const source = {
      mode: 'import',
      name: 'a.csv',
      preview: 'a\n1\n',
      complete: true,
      canReplace: false,
    };
    deliver({ ...envelope, type: 'csvSource', source });
    expect(await opened).toEqual(source);
  });

  it('answers each run with the outcome of the same request', async () => {
    const { adapter, posted, deliver } = fakeWebview();
    const options = {
      delimiter: ',',
      header: true,
      flattenObjects: true,
      flattenArrays: false,
      bom: false,
    } as const;
    const first = adapter.run({ action: 'save', options });
    const second = adapter.run({ action: 'copy', options });
    expect(posted).toEqual([
      { ...envelope, type: 'csvRun', request: 1, run: { action: 'save', options } },
      { ...envelope, type: 'csvRun', request: 2, run: { action: 'copy', options } },
    ]);
    deliver({ ...envelope, type: 'csvOutcome', request: 2, outcome: { error: { message: 'x' } } });
    deliver({ ...envelope, type: 'csvOutcome', request: 1, outcome: { done: true } });
    expect(await first).toEqual({ done: true });
    expect(await second).toEqual({ error: { message: 'x' } });
  });

  it('reports a message it cannot decode', () => {
    const { posted, deliver } = fakeWebview();
    deliver({ ...envelope, protocol: 11, type: 'csvOutcome', request: 1, outcome: { done: true } });
    expect(posted).toMatchObject([{ type: 'error', code: 'bad-message' }]);
  });
});
