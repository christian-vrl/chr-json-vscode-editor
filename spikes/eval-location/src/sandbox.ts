// Option A's frame (spike 004 T1): runs Ajv where eval is allowed and answers the page that
// embeds it. The same bundle backs the VS Code child frame and the MV3 sandbox page (mv3.mjs).
// It talks only to window.parent and has no network access (its CSP has connect-src 'none').
import { compile, describeError, run, type Compiled } from './ajv-runner';
import type { FrameReply, FrameRequest } from './protocol';

function reply(message: FrameReply): void {
  window.parent.postMessage(message, '*');
}

function evalProbe(): { evalAllowed: boolean; evalError?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the probe is the point
    return { evalAllowed: (new Function('return 1') as () => number)() === 1 };
  } catch (error) {
    return { evalAllowed: false, evalError: describeError(error) };
  }
}

let compiled: Compiled | undefined;

window.addEventListener('message', (event: MessageEvent<FrameRequest>) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  try {
    if (message.type === 'compile') {
      compiled = compile(message.schema);
      reply({ type: 'compiled', compileMs: compiled.compileMs });
    } else if (message.type === 'validate') {
      if (!compiled) throw new Error('validate before compile');
      reply({ type: 'validated', ...run(compiled, message.data) });
    }
  } catch (error) {
    reply(
      message.type === 'compile'
        ? { type: 'compiled', compileMs: null, error: describeError(error) }
        : { type: 'failed', error: describeError(error) },
    );
  }
});

reply({ type: 'frameReady', ...evalProbe() });
