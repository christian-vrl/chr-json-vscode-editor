// UNK-029: vanilla-jsoneditor ships its CSS as JavaScript. Its bundle calls one helper with each
// component's stylesheet as a string literal, and the helper appends a `<style>` element to <head>
// at runtime. The webview CSP (spec 003 criterion 6) has no `unsafe-inline` for styles, so those
// elements are blocked and the editor renders unstyled.
//
// This plugin moves that CSS into the build's stylesheet instead: it finds the helper by its body
// (`document.createElement("style")` and the `insertAt` option), takes every call that passes it
// one string literal, removes the call, and hands the strings, in source order, to Vite as a CSS
// module that the library module imports. The page then loads the styles as a file from the
// webview source, which `style-src` allows. The helper itself is made to throw, so a library
// update that calls it any other way fails loudly instead of rendering unstyled.
//
// The library loads its colour picker, vanilla-picker, with `import("vanilla-picker")`, and that
// module injects a `<style>` of its own. vanilla-picker ships a CSP build for this case
// (dist/vanilla-picker.csp.mjs with its CSS in dist/vanilla-picker.csp.css), so the plugin points
// the import at it and adds its stylesheet to the bundle.
//
// CodeMirror (the text mode) builds its styles at runtime from its themes, so they cannot be moved
// into a file. Its style-mod package writes them into one `<style>` element and sets a nonce on it
// when CodeMirror is given one (the `EditorView.cspNonce` facet), but vanilla-jsoneditor has no
// option to pass one. So the plugin makes style-mod fall back to the nonce of the page's own
// scripts (UNK-029's second option, for the styles the first one cannot reach). A page without a
// nonce keeps style-mod's behaviour.
import type { Plugin } from 'vite';
import { parseAst } from 'vite';

const LIBRARY = /[\\/]vanilla-jsoneditor[\\/]index\.js$/;
const CSS_ID = 'virtual:chr-library-css.css';
const RESOLVED_CSS_ID = '/@chr-library-css.css';
const PICKER = 'vanilla-picker';
const PICKER_CSP = 'vanilla-picker/dist/vanilla-picker.csp.mjs';
const PICKER_CSS = 'vanilla-picker/dist/vanilla-picker.csp.css';
const STYLE_MOD = /[\\/]style-mod[\\/]src[\\/]style-mod\.js$/;
const STYLE_MOD_NONCE = 'nonce = options && options.nonce';

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

/** What the plugin found in the library, for the build log and tests. */
export interface ExtractedCss {
  helper: string;
  css: string[];
}

/** Rewrites the library's code; exported for the unit test. Throws when the helper is not found. */
export function extractInjectedCss(code: string): { code: string; extracted: ExtractedCss } {
  const ast = parseAst(code) as unknown as Node;
  const helpers: Node[] = [];
  walk(ast, (node) => {
    if (node.type !== 'FunctionDeclaration') return;
    const body = code.slice(node.start, node.end);
    if (body.includes('createElement("style")') && body.includes('insertAt')) helpers.push(node);
  });
  if (helpers.length !== 1) {
    throw new Error(
      `vanilla-jsoneditor: expected one style-inject helper, found ${helpers.length}`,
    );
  }
  const helper = helpers[0]!;
  const name = (helper.id as Node & { name: string }).name;

  const edits: { start: number; end: number; text: string }[] = [];
  const css: string[] = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee as Node & { name?: string };
    const args = node.arguments as (Node & { value?: unknown })[];
    if (callee.type !== 'Identifier' || callee.name !== name) return;
    const [arg] = args;
    if (args.length !== 1 || arg?.type !== 'Literal' || typeof arg.value !== 'string') {
      throw new Error(`vanilla-jsoneditor: ${name}() called without one string literal`);
    }
    css.push(arg.value);
    edits.push({ start: node.start, end: node.end, text: 'void 0' });
  });
  if (css.length === 0) throw new Error(`vanilla-jsoneditor: no ${name}() call found`);

  const body = helper.body as Node;
  edits.push({
    start: body.start,
    end: body.end,
    text: `{throw new Error("vanilla-jsoneditor injected CSS at runtime; see vite-plugin-library-css.mts")}`,
  });
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return { code: out, extracted: { helper: name, css } };
}

/** Makes style-mod use the page's script nonce when none is passed; exported for the unit test. */
export function styleModPageNonce(code: string): string {
  const at = code.indexOf(STYLE_MOD_NONCE);
  if (at === -1 || code.indexOf(STYLE_MOD_NONCE, at + 1) !== -1) {
    throw new Error(`style-mod: expected one "${STYLE_MOD_NONCE}"`);
  }
  return (
    code.slice(0, at) +
    'nonce = (options && options.nonce) || chrPageNonce(root)' +
    code.slice(at + STYLE_MOD_NONCE.length) +
    `
// Added by app-shell's vite-plugin-library-css.mts (UNK-029): the nonce the page's scripts carry.
function chrPageNonce(root) {
  let doc = root.ownerDocument || root
  let script = doc.querySelector && doc.querySelector("script[nonce]")
  return (script && script.nonce) || undefined
}
`
  );
}

export function libraryCss(): Plugin {
  let css = '';
  return {
    name: 'chr-library-css',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (id === CSS_ID) return RESOLVED_CSS_ID;
      if (id === PICKER && importer && LIBRARY.test(importer)) {
        const resolved = await this.resolve(PICKER_CSP, importer, { skipSelf: true });
        if (!resolved) throw new Error(`vanilla-jsoneditor: cannot resolve ${PICKER_CSP}`);
        return resolved;
      }
      return undefined;
    },
    load(id) {
      return id === RESOLVED_CSS_ID ? css : undefined;
    },
    transform(code, id) {
      if (STYLE_MOD.test(id)) return { code: styleModPageNonce(code), map: null };
      if (!LIBRARY.test(id)) return undefined;
      const { code: rewritten, extracted } = extractInjectedCss(code);
      css = extracted.css.join('\n');
      this.info(`moved ${extracted.css.length} injected stylesheets into the CSS bundle`);
      const imports = [CSS_ID, PICKER_CSS].map((css) => `import ${JSON.stringify(css)};`);
      return { code: `${imports.join('\n')}\n${rewritten}`, map: null };
    },
  };
}
