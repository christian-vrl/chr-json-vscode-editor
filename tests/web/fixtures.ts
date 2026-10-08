// Offline fixture for `pnpm test:web` (001 T6, T8). Every test's browser context lets requests to the
// local static server through and aborts every request (and WebSocket) to any other origin.
// `blockedRequests` lists the URLs it stopped, so a test can assert what the page tried to reach.
//
// After each test the fixture checks that every blocked HTTP request really failed with
// net::ERR_BLOCKED_BY_CLIENT (so a route that let requests through cannot pass), and fails the test
// if anything was blocked at all. A test that makes foreign requests on purpose, to prove they are
// blocked, opts out of that last rule with `test.use({ expectBlockedRequests: true })`.
//
// 003 T5 (UNK-029, and 003 T9's contrast re-proved there): every page is served under the VS Code
// webview's CSP (webviewHtml.ts, spec 003 criterion 6) with the local origin standing in for
// `webview.cspSource`, its own scripts and stylesheets tagged with the nonce as renderWebviewHtml
// does. Any CSP violation fails the test. Such a CSP also refuses `fetch` to other origins before
// the request exists, so the tests that prove the offline block itself turn it off with
// `test.use({ webviewCsp: false })`.
import { test as base, expect } from '@playwright/test';
import { contentSecurityPolicy } from '../../packages/vscode-extension/src/webviewHtml';

/** Fixed, since the pages are local test builds; base64 like createNonce's. */
const NONCE = 'dGVzdC13ZWItbm9uY2UtMDE=';

declare global {
  interface Window {
    chrCspViolation?: (violation: string) => void;
  }
}

/** Chromium's error for a request the client aborted; `.Inspector` when DevTools interception did it. */
export const BLOCKED_BY_CLIENT = /^net::ERR_BLOCKED_BY_CLIENT(\.Inspector)?$/;

export const test = base.extend<{
  blockedRequests: string[];
  expectBlockedRequests: boolean;
  webviewCsp: boolean;
}>({
  expectBlockedRequests: [false, { option: true }],
  webviewCsp: [true, { option: true }],
  blockedRequests: [
    async ({ context, baseURL, expectBlockedRequests, webviewCsp }, use) => {
      if (!baseURL) throw new Error('test:web: baseURL must be set in playwright.config.mts');
      const origin = new URL(baseURL).origin;
      const blocked: string[] = [];
      const blockedHttp: string[] = [];
      const failures = new Map<string, string>();
      context.on('requestfailed', (request) => {
        failures.set(request.url(), request.failure()?.errorText ?? '');
      });
      const violations: string[] = [];
      if (webviewCsp) {
        await context.exposeBinding('chrCspViolation', (_source, violation: string) => {
          violations.push(violation);
        });
        await context.addInitScript(() => {
          document.addEventListener('securitypolicyviolation', (e) => {
            void window.chrCspViolation?.(
              `${e.effectiveDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}`,
            );
          });
        });
      }
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === origin) {
          if (!webviewCsp || route.request().resourceType() !== 'document') return route.continue();
          const response = await route.fetch();
          const html = (await response.text()).replace(/<(script|link) /g, `<$1 nonce="${NONCE}" `);
          return route.fulfill({
            response,
            body: html,
            headers: {
              ...response.headers(),
              'content-security-policy': contentSecurityPolicy(origin, NONCE),
            },
          });
        }
        blocked.push(url);
        blockedHttp.push(url);
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket(/.*/, (ws) => {
        if (new URL(ws.url()).origin.replace(/^ws/, 'http') === origin) return ws.connectToServer();
        blocked.push(ws.url());
        return ws.close();
      });
      await use(blocked);
      expect(violations, 'test:web: the page broke the webview CSP').toEqual([]);

      for (const url of blockedHttp) {
        await expect
          .poll(() => failures.get(url), {
            message: `test:web: ${url} was not aborted as net::ERR_BLOCKED_BY_CLIENT`,
            timeout: 2_000,
          })
          .toMatch(BLOCKED_BY_CLIENT);
      }
      if (!expectBlockedRequests) {
        expect(blocked, 'test:web: the page requested something outside the local origin').toEqual(
          [],
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
