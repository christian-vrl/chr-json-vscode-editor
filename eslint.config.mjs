// ESLint flat config (001 T3). Type-aware typescript-eslint rules for TypeScript sources; plain
// recommended rules for JavaScript tooling files. Formatting belongs to Prettier, so
// eslint-config-prettier comes last and turns off every rule that would fight it.
import path from 'node:path';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  includeIgnoreFile(path.join(import.meta.dirname, '.gitignore'), '.gitignore'),
  // Vendored json5-tests fixtures (002 T5): some `.js` cases are invalid on purpose.
  globalIgnores(['packages/core/test/fixtures/json5-tests/']),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
);
