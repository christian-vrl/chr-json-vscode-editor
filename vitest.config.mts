// Vitest (001 T4). Two projects back the standard scripts: `unit` runs each package's tests
// (pnpm test:unit) and `golden` runs the golden-master corpus under tests/golden (pnpm test:golden).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages resolve to source, as in tsconfig.json's `paths`, so tests never need a build.
  resolve: {
    alias: {
      '@chr-json-editor/core': fileURLToPath(
        new URL('packages/core/src/index.ts', import.meta.url),
      ),
      '@chr-json-editor/app-shell/protocol': fileURLToPath(
        new URL('packages/app-shell/src/protocol.ts', import.meta.url),
      ),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'packages/*/test/**/*.test.ts',
            'tests/licenses/**/*.test.ts',
            'tests/offline/**/*.test.ts',
            'tests/gate-review/**/*.test.ts',
            'tests/ci/**/*.test.ts',
          ],
        },
      },
      { test: { name: 'golden', include: ['tests/golden/**/*.test.ts'] } },
    ],
  },
});
