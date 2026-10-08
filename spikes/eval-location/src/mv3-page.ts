// MV3 extension page for spike 004 T1 (mv3.mjs): embeds the sandbox page the way an MV3 extension
// would (manifest `sandbox.pages`) and runs the same compile/validate exchange as the VS Code page.
// The result goes on `window.spikeResult` for Playwright to read.
import { RUNS, type FrameReply, type FrameRequest, type Measurement } from './protocol';

declare global {
  interface Window {
    spikeResult?: Measurement;
  }
}

const frameName = new URLSearchParams(location.search).get('frame') ?? 'sandbox.html';

async function measure(): Promise<Measurement> {
  const [schema, text] = await Promise.all([
    fetch('schema.json').then((r) => r.json() as Promise<object>),
    fetch('doc.json').then((r) => r.text()),
  ]);
  const frame = document.createElement('iframe');
  frame.src = frameName;
  const replies: FrameReply[] = [];
  let wake: (() => void) | undefined;
  window.addEventListener('message', (event: MessageEvent<FrameReply>) => {
    if (event.source !== frame.contentWindow) return;
    replies.push(event.data);
    wake?.();
  });
  const next = (): Promise<FrameReply> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no reply from the frame within 10000 ms')),
        10_000,
      );
      const take = () => {
        const reply = replies.shift();
        if (reply) {
          clearTimeout(timer);
          resolve(reply);
        }
      };
      wake = take;
      take();
    });
  const send = (request: FrameRequest) => frame.contentWindow?.postMessage(request, '*');
  const empty = (error: string): Measurement => ({
    compileMs: null,
    totalMs: [],
    validateMs: [],
    errors: null,
    error,
  });

  const created = performance.now();
  document.body.append(frame);
  const ready = await next();
  const frameLoadMs = performance.now() - created;
  if (ready.type !== 'frameReady' || !ready.evalAllowed) {
    return {
      ...empty(
        `eval blocked in the frame: ${ready.type === 'frameReady' ? ready.evalError : ready.type}`,
      ),
      frameLoadMs,
    };
  }
  send({ type: 'compile', schema });
  const compiled = await next();
  if (compiled.type !== 'compiled' || compiled.compileMs === null) {
    return {
      ...empty(`compile failed: ${compiled.type === 'compiled' ? compiled.error : compiled.type}`),
      frameLoadMs,
    };
  }
  const result: Measurement = {
    compileMs: compiled.compileMs,
    totalMs: [],
    validateMs: [],
    errors: null,
    frameLoadMs,
  };
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    send({ type: 'validate', data: JSON.parse(text) });
    const validated = await next();
    if (validated.type !== 'validated') return { ...result, error: validated.type };
    result.totalMs.push(performance.now() - t0);
    result.validateMs.push(validated.validateMs);
    result.errors = validated.errors;
  }
  return result;
}

measure().then(
  (result) => (window.spikeResult = result),
  (error: unknown) =>
    (window.spikeResult = {
      compileMs: null,
      totalMs: [],
      validateMs: [],
      errors: null,
      error: String(error),
    }),
);
