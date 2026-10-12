// Types for esbuild.web.mjs, which node runs as plain JavaScript.
import type { BuildOptions } from 'esbuild';

export function browserEntryOptions(options: {
  testHooks: boolean;
  outfile?: string;
}): BuildOptions;
