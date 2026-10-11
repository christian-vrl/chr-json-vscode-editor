// What both spike pages share: the VS Code API, the CSP violation log and the page's own policy.
import type { PageInfo, StartMessage, Violation } from './protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

export const vscode = acquireVsCodeApi();

/** The nonce the page's own script carries (route b gives it to the script it adds). */
export const pageNonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? '';

const violations: Violation[] = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({
    directive: event.effectiveDirective,
    blockedURI: event.blockedURI,
    sample: event.sample,
  });
});

export function pageInfo(): PageInfo {
  return {
    policy:
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? '',
    userAgent: navigator.userAgent,
    violations: [...violations],
  };
}

export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Violation events are queued as tasks; give them a turn before reporting. */
export function settle(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function onStart(handler: (start: StartMessage) => void | Promise<void>): void {
  window.addEventListener('message', (event: MessageEvent<{ type: string }>) => {
    if (event.data?.type === 'start') void handler(event.data as StartMessage);
    if (event.data?.type === 'ping') vscode.postMessage({ type: 'pong' });
  });
  vscode.postMessage({ type: 'pageReady' });
}
