// Webview HTML and its Content Security Policy (spec 003 T4, criterion 6). Pure functions with no
// `vscode` import, so unit tests can call them. The page loads only the scripts and stylesheets it
// is given, each tagged with the nonce; pointing the webview at the app-shell bundle (003 T2) means
// passing its URIs here.

export interface WebviewPage {
  /** `webview.cspSource`: the origin VS Code serves `localResourceRoots` from. */
  cspSource: string;
  /** Fresh per render; see `createNonce`. */
  nonce: string;
  title: string;
  /** `webview.asWebviewUri` strings, loaded in order as module-less classic scripts. */
  scripts: readonly string[];
  stylesheets: readonly string[];
  /** Trusted HTML placed in `<body>` before the scripts. */
  body?: string;
}

/** 128 random bits, base64: the CSP3 nonce length recommendation. Web Crypto, which Node 22 and
 *  the web host both have as `crypto` (spec 013 T1), not `node:crypto`. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Criterion 6: nothing loads unless listed; scripts only with the nonce (no host source, no
 * `unsafe-inline`, no `unsafe-eval`); stylesheets from the webview source or with the nonce; no
 * network connections. Inline `style` attributes are blocked; styles set through the CSSOM
 * (`element.style.x = ...`) are not.
 *
 * `wasm` adds `'wasm-unsafe-eval'` to `script-src` and changes nothing else: the CHR JSON editor
 * page compiles the query engine's WebAssembly with it (spec 011 criterion 9, UNK-048 ★); the
 * panels never pass it.
 */
export function contentSecurityPolicy(
  cspSource: string,
  nonce: string,
  { wasm = false }: { wasm?: boolean } = {},
): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${wasm ? " 'wasm-unsafe-eval'" : ''}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function renderWebviewHtml(page: WebviewPage): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(page.nonce)) {
    throw new Error('nonce must be base64');
  }
  const nonce = escapeHtml(page.nonce);
  const links = page.stylesheets.map(
    (href) => `<link rel="stylesheet" nonce="${nonce}" href="${escapeHtml(href)}">`,
  );
  const scripts = page.scripts.map(
    (src) => `<script nonce="${nonce}" src="${escapeHtml(src)}"></script>`,
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(page.cspSource, page.nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
${links.join('\n')}
</head>
<body>
${page.body ?? ''}
${scripts.join('\n')}
</body>
</html>
`;
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
