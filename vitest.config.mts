// Vitest (001 T4). Two projects back the standard scripts: `unit` runs each package's tests
// (pnpm test:unit) and `golden` runs the golden-master corpus under tests/golden (pnpm test:golden).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'tests/licenses/**/*.test.ts'],
        },
      },
      { test: { name: 'golden', include: ['tests/golden/**/*.test.ts'] } },
    ],
  },
});
