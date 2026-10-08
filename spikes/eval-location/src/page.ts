// The editor webview's script in spike 004 T1. Loaded with the CSP nonce like 003 T4's script; runs
// the variant the host names and reports one ResultMessage. Runs in the webview: no `vscode` or
// Node imports.
import { compile, describeError, run } from './ajv-runner';
import {
  RUNS,
  type CspViolation,
  type FrameReply,
  type FrameRequest,
  type Measurement,
  type ResultMessage,
  type StartMessage,
} from './protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';

const violations: CspViolation[] = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    violatedDirective: e.violatedDirective,
    blockedURI: e.blockedURI,
    sourceFile: e.sourceFile,
  });
});

const FRAME_TIMEOUT_MS = 10_000;

function empty(error: string): Measurement {
  return { compileMs: null, totalMs: [], validateMs: [], errors: null, error };
}

function inMainFrame(start: StartMessage): Measurement {
  try {
    const compiled = compile(start.schema);
    const result: Measurement = {
      compileMs: compiled.compileMs,
      totalMs: [],
      validateMs: [],
      errors: null,
    };
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const { errors, validateMs } = run(compiled, JSON.parse(start.text));
      result.totalMs.push(performance.now() - t0);
      result.validateMs.push(validateMs);
      result.errors = errors;
    }
    return result;
  } catch (error) {
    return empty(describeError(error));
  }
}

// Runs first in srcdoc and blob: frames: reports whether eval works there before Ajv's bundle loads,
// so the result says why even if sandbox.js never arrives.
const PROBE = `try { new Function('return 1')(); parent.postMessage({ type: 'probe', evalAllowed: true }, '*'); }
catch (e) { parent.postMessage({ type: 'probe', evalAllowed: false, evalError: e.name + ': ' + e.message }, '*'); }`;

/**
 * HTML for frames that have no file of their own (srcdoc, blob:). They inherit the page's CSP
 * (CSP3 policy container inheritance for local schemes), so their own <meta> can only tighten it;
 * the nonce lets their scripts start at all.
 */
function inlineFrameHtml(start: StartMessage): string {
  const script = start.sandboxUrl.replace(/sandbox\.html(\?.*)?$/, 'sandbox.js');
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' https://*.vscode-cdn.net; connect-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script nonce="${nonce}">${PROBE}</script><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

function createFrame(start: StartMessage): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  // Opaque origin: the frame cannot reach the page's DOM, storage or acquireVsCodeApi.
  if (start.variant !== 'iframe-src-unsandboxed') frame.setAttribute('sandbox', 'allow-scripts');
  frame.hidden = true;
  if (start.variant === 'iframe-srcdoc') {
    frame.srcdoc = inlineFrameHtml(start);
  } else if (start.variant === 'iframe-blob') {
    frame.src = URL.createObjectURL(new Blob([inlineFrameHtml(start)], { type: 'text/html' }));
  } else {
    frame.src = start.sandboxUrl;
  }
  return frame;
}

async function inChildFrame(start: StartMessage): Promise<Measurement> {
  const probe: { value?: Measurement['frameProbe'] } = {};
  const measurement = await childFrameMeasurement(start, probe);
  return probe.value ? { ...measurement, frameProbe: probe.value } : measurement;
}

async function childFrameMeasurement(
  start: StartMessage,
  probe: { value?: Measurement['frameProbe'] },
): Promise<Measurement> {
  const frame = createFrame(start);
  const replies: FrameReply[] = [];
  let wake: (() => void) | undefined;
  window.addEventListener('message', (event: MessageEvent<FrameReply>) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data.type === 'probe') {
      const { evalAllowed, evalError } = event.data;
      probe.value = { evalAllowed, evalError };
      return;
    }
    replies.push(event.data);
    wake?.();
  });
  const next = (what: string): Promise<FrameReply> =>
    new Promise((resolve, reject) => {
      const take = () => {
        const reply = replies.shift();
        if (reply) {
          clearTimeout(timer);
          wake = undefined;
          resolve(reply);
        }
      };
      const timer = setTimeout(
        () => reject(new Error(`no ${what} from the frame within ${FRAME_TIMEOUT_MS} ms`)),
        FRAME_TIMEOUT_MS,
      );
      wake = take;
      take();
    });
  const send = (request: FrameRequest) => frame.contentWindow?.postMessage(request, '*');

  const created = performance.now();
  document.body.append(frame);
  let ready: FrameReply;
  try {
    ready = await next('frameReady');
  } catch (error) {
    return empty(describeError(error));
  }
  const frameLoadMs = performance.now() - created;
  if (ready.type !== 'frameReady') return { ...empty(`unexpected ${ready.type}`), frameLoadMs };
  if (!ready.evalAllowed) {
    return { ...empty(`frame loaded but eval is blocked: ${ready.evalError}`), frameLoadMs };
  }
  try {
    send({ type: 'compile', schema: start.schema });
    const compiled = await next('compiled');
    if (compiled.type !== 'compiled' || compiled.compileMs === null) {
      return {
        ...empty(
          `compile failed: ${compiled.type === 'compiled' ? compiled.error : compiled.type}`,
        ),
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
      send({ type: 'validate', data: JSON.parse(start.text) });
      const validated = await next('validated');
      if (validated.type !== 'validated')
        throw new Error(validated.type === 'failed' ? validated.error : validated.type);
      result.totalMs.push(performance.now() - t0);
      result.validateMs.push(validated.validateMs);
      result.errors = validated.errors;
    }
    return result;
  } catch (error) {
    return { ...empty(describeError(error)), frameLoadMs };
  }
}

/** Option B: the host parses and validates; the page only receives the errors. */
async function inHost(): Promise<Measurement> {
  const result: Measurement = { compileMs: null, totalMs: [], validateMs: [], errors: null };
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const reply = await new Promise<HostReply>((resolve) => {
      hostWaiter = resolve;
      vscode.postMessage({ type: 'hostValidate', run: i });
    });
    if (reply.error) return { ...result, error: reply.error };
    result.totalMs.push(performance.now() - t0);
    result.validateMs.push(reply.validateMs);
    if (reply.compileMs !== null) result.compileMs = reply.compileMs;
    result.errors = reply.errors;
  }
  return result;
}

interface HostReply {
  type: 'hostErrors';
  compileMs: number | null;
  validateMs: number;
  errors: Measurement['errors'];
  error?: string;
}
let hostWaiter: ((reply: HostReply) => void) | undefined;

window.addEventListener('message', (event: MessageEvent<StartMessage | HostReply>) => {
  // Messages from the extension host arrive from the webview's own window wrapper.
  const message = event.data;
  if (message.type === 'hostErrors') {
    hostWaiter?.(message);
    return;
  }
  if (message.type !== 'start') return;
  void (async () => {
    const measurement =
      message.variant === 'main-frame'
        ? inMainFrame(message)
        : message.variant === 'host'
          ? await inHost()
          : await inChildFrame(message);
    // Let late CSP violation events land before reporting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const policy =
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '';
    const result: ResultMessage = {
      type: 'result',
      variant: message.variant,
      policy,
      violations,
      userAgent: navigator.userAgent,
      ...measurement,
    };
    vscode.postMessage(result);
  })();
});

vscode.postMessage({ type: 'pageReady' });
