// Offline fixture for `pnpm test:web` (001 T6). Every test's browser context lets requests to the
// local static server through and aborts every request (and WebSocket) to any other origin.
// `blockedRequests` lists the URLs it stopped, so a test can assert what the page tried to reach.
import { test as base } from '@playwright/test';

export const test = base.extend<{ blockedRequests: string[] }>({
  blockedRequests: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error('test:web: baseURL must be set in playwright.config.mts');
      const origin = new URL(baseURL).origin;
      const blocked: string[] = [];
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).origin === origin) return route.continue();
        blocked.push(url);
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket(/.*/, (ws) => {
        if (new URL(ws.url()).origin.replace(/^ws/, 'http') === origin) return ws.connectToServer();
        blocked.push(ws.url());
        return ws.close();
      });
      await use(blocked);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
