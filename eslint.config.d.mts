// Types for eslint.config.mjs, which packages/vscode-extension/test/unit/nodeImports.test.ts
// imports (013 T2).
import type { Linter } from 'eslint';

/** The blocks for the extension's host code (spec 013 criterion 2). */
export declare const sharedHostCode: Linter.Config[];
declare const config: Linter.Config[];
export default config;
