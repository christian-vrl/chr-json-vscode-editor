// Expected-failure run for `pnpm test:web` (001 T8): the root config, but serving this fixture's page,
// which calls fetch('https://example.com'). Must exit non-zero:
//
//   pnpm exec playwright test -c tests/fixtures/offline-fetch/playwright.config.mts
import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config.mts';

const web = new URL('web', import.meta.url).pathname;

export default defineConfig(base, {
  testDir: '.',
  testMatch: 'offline-fetch.spec.ts',
  webServer: {
    ...base.webServer,
    command: `pnpm --filter @chr-json-editor/app-shell exec vite preview --outDir ${web}`,
  },
});
