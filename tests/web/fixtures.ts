// Offline fixture for `pnpm test:web` (001 T6, T8). Every test's browser context lets requests to the
// local static server through and aborts every request (and WebSocket) to any other origin.
// `blockedRequests` lists the URLs it stopped, so a test can assert what the page tried to reach.
//
// After each test the fixture checks that every blocked HTTP request really failed with
// net::ERR_BLOCKED_BY_CLIENT (so a route that let requests through cannot pass), and fails the test
// if anything was blocked at all. A test that makes foreign requests on purpose, to prove they are
// blocked, opts out of that last rule with `test.use({ expectBlockedRequests: true })`.
import { test as base, expect } from '@playwright/test';

/** Chromium's error for a request the client aborted; `.Inspector` when DevTools interception did it. */
export const BLOCKED_BY_CLIENT = /^net::ERR_BLOCKED_BY_CLIENT(\.Inspector)?$/;

export const test = base.extend<{ blockedRequests: string[]; expectBlockedRequests: boolean }>({
  expectBlockedRequests: [false, { option: true }],
  blockedRequests: [
    async ({ context, baseURL, expectBlockedRequests }, use) => {
      if (!baseURL) throw new Error('test:web: baseURL must be set in playwright.config.mts');
      const origin = new URL(baseURL).origin;
      const blocked: string[] = [];
      const blockedHttp: string[] = [];
      const failures = new Map<string, string>();
      context.on('requestfailed', (request) => {
        failures.set(request.url(), request.failure()?.errorText ?? '');
      });
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === origin) return route.continue();
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
