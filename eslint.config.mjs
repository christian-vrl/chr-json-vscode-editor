// ESLint flat config (001 T3). Type-aware typescript-eslint rules for TypeScript sources; plain
// recommended rules for JavaScript tooling files. Formatting belongs to Prettier, so
// eslint-config-prettier comes last and turns off every rule that would fight it.
import { builtinModules } from 'node:module';
import path from 'node:path';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Spec 013 criterion 2 (013 T2): the extension's host code runs in the web worker host too, which
// has no Node, so no file under packages/vscode-extension/src may import a Node built-in except the
// Node-only ones under src/node/, and only the Node entry (src/extension.ts) may import those.
// packages/vscode-extension/test/unit/nodeImports.test.ts shows the rule failing on its fixture.
const NODE_BUILTIN_MESSAGE =
  'Node built-ins are not available in the web host (spec 013 criterion 2): put Node-only code under src/node/.';
const nodeBuiltins = {
  paths: builtinModules
    .filter((name) => !name.startsWith('node:'))
    .map((name) => ({ name, message: NODE_BUILTIN_MESSAGE })),
  patterns: [{ regex: '^node:', message: NODE_BUILTIN_MESSAGE }],
};
const NODE_FOLDER_PATTERN = {
  regex: '(^|/)node/',
  message: 'Only the Node entry (src/extension.ts) imports src/node/ (spec 013 criterion 2).',
};
// A built-in's subpaths (`fs/promises`) are matched by its name followed by `/`.
const builtinNames = builtinModules.filter(
  (name) => !name.includes('/') && !name.startsWith('node:'),
);
// `import()` and CommonJS `require()` of the same names, which the import rule does not see.
const BUILTIN_SOURCE = `/^(node:|(${builtinNames.join('|')})(\\/|$))/`;
const NODE_FOLDER_SOURCE = '/(^|\\/)node\\//';
const nodeBuiltinCalls = [
  {
    selector: `ImportExpression > Literal[value=${BUILTIN_SOURCE}]`,
    message: NODE_BUILTIN_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal[value=${BUILTIN_SOURCE}]`,
    message: NODE_BUILTIN_MESSAGE,
  },
];
const nodeFolderCalls = [
  {
    selector: `ImportExpression > Literal[value=${NODE_FOLDER_SOURCE}]`,
    message: NODE_FOLDER_PATTERN.message,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal[value=${NODE_FOLDER_SOURCE}]`,
    message: NODE_FOLDER_PATTERN.message,
  },
];
/** The blocks for the host code; `nodeImports.test.ts` lints its fixture with these. */
export const sharedHostCode = [
  {
    name: 'chr/shared-host-code',
    files: ['packages/vscode-extension/src/**/*.{ts,mts,cts,js,mjs,cjs}'],
    ignores: ['packages/vscode-extension/src/node/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { ...nodeBuiltins, patterns: [...nodeBuiltins.patterns, NODE_FOLDER_PATTERN] },
      ],
      'no-restricted-syntax': ['error', ...nodeBuiltinCalls, ...nodeFolderCalls],
    },
  },
  {
    name: 'chr/node-entry',
    files: ['packages/vscode-extension/src/extension.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', nodeBuiltins],
      'no-restricted-syntax': ['error', ...nodeBuiltinCalls],
    },
  },
];

export default defineConfig(
  includeIgnoreFile(path.join(import.meta.dirname, '.gitignore'), '.gitignore'),
  // Vendored json5-tests fixtures (002 T5): some `.js` cases are invalid on purpose.
  globalIgnores(['packages/core/test/fixtures/json5-tests/']),
  // Query cases (011 T2): scripts that define `query` for the engine, with Lodash's `_` in scope.
  globalIgnores(['tests/query/*/']),
  // Spec 013 criterion 2's fixture (013 T2): imports Node on purpose; nodeImports.test.ts lints it.
  globalIgnores(['tests/fixtures/node-import/']),
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
  ...sharedHostCode,
  prettier,
);
