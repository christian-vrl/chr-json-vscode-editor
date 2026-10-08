// Prettier (001 T3). Indentation and line endings follow .editorconfig, which Prettier reads.
// prettier-plugin-svelte formats app-shell's .svelte components (003 T2).
/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  plugins: ['prettier-plugin-svelte'],
};
