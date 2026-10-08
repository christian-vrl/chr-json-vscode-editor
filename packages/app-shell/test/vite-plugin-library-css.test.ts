// UNK-029's Vite plugin (vite-plugin-library-css.mts): it moves vanilla-jsoneditor's injected CSS
// into the build and gives style-mod the page nonce. Run against the installed library versions,
// so an update that changes their shape fails here before a webview renders unstyled.
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractInjectedCss, libraryCss, styleModPageNonce } from '../vite-plugin-library-css.mts';

// pnpm links each package's dependencies next to it: CodeMirror's view beside the library, and
// style-mod (CodeMirror's) beside the view.
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryDir = realpathSync(path.join(app, 'node_modules', 'vanilla-jsoneditor'));
const library = readFileSync(path.join(libraryDir, 'index.js'), 'utf8');
const viewDir = realpathSync(path.join(libraryDir, '..', '@codemirror', 'view'));
const styleModDir = realpathSync(path.join(viewDir, '..', '..', 'style-mod'));
const styleMod = readFileSync(path.join(styleModDir, 'src', 'style-mod.js'), 'utf8');

describe('extractInjectedCss on vanilla-jsoneditor', () => {
  const { code, extracted } = extractInjectedCss(library);

  it('takes every stylesheet the library would inject', () => {
    expect(extracted.css.length).toBeGreaterThan(40);
    expect(extracted.css.join('\n')).toContain('.jse-main');
    expect(extracted.css.join('\n')).toMatch(/min-height:\s*150px/);
  });

  it('leaves no call to the helper, whose body now throws', () => {
    const calls = code.match(new RegExp(`(?<![\\w$.])${extracted.helper}\\(`, 'g')) ?? [];
    expect(calls).toHaveLength(1); // the declaration itself
    expect(code).toContain('vanilla-jsoneditor injected CSS at runtime');
    expect(code).not.toContain('createElement("style")');
  });
});

describe('extractInjectedCss on other code', () => {
  const helper =
    'function s(e,n){void 0===n&&(n={});var t=n.insertAt;var r=document.createElement("style");r.appendChild(document.createTextNode(e))}';

  it('moves literal calls out in source order', () => {
    const { code, extracted } = extractInjectedCss(`${helper}s(".a{}");s('.b{}');`);
    expect(extracted).toEqual({ helper: 's', css: ['.a{}', '.b{}'] });
    expect(code).toMatch(/void 0;void 0;$/);
  });

  it('fails when the helper is called with something other than one string literal', () => {
    expect(() => extractInjectedCss(`${helper}var c=".a{}";s(c);`)).toThrow(/string literal/);
  });

  it('fails when the helper is missing', () => {
    expect(() => extractInjectedCss('var x = 1;')).toThrow(/found 0/);
  });
});

describe('styleModPageNonce', () => {
  it("falls back to the page script's nonce in style-mod's mount", () => {
    const code = styleModPageNonce(styleMod);
    expect(code).toContain('nonce = (options && options.nonce) || chrPageNonce(root)');
    expect(code).toContain('function chrPageNonce(root)');
  });

  it('fails when style-mod no longer reads the nonce that way', () => {
    expect(() => styleModPageNonce('export class StyleModule {}')).toThrow(/style-mod/);
  });
});

describe('libraryCss', () => {
  it('refuses to load the extracted CSS before the library was transformed', () => {
    const plugin = libraryCss() as unknown as { load(id: string): unknown };
    expect(() => plugin.load('/@chr-library-css.css')).toThrow(/before the library's CSS/);
    expect(plugin.load('/other.css')).toBeUndefined();
  });
});
