// Playwright (001 T6) behind `pnpm test:web`: serves app-shell's Vite build (packages/app-shell/dist/web)
// from a local static server and runs tests/web in Chromium. tests/web/fixtures.ts aborts every
// request to any other origin, so no test can reach the network.
//
// Browsers come from `playwright install chromium` (CI, 001 T10). Where that download is unavailable,
// set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chromium instead.
import { defineConfig, devices } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: 'tests/web',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: origin, serviceWorkers: 'block' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @chr-json-editor/app-shell exec vite preview',
    url: origin,
    reuseExistingServer: false,
  },
});
