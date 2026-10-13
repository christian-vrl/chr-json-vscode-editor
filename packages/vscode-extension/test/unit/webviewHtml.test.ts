// Unit checks for the webview HTML template (003 T4). The gate itself is the e2e test, which reads
// the HTML VS Code was given; these pin the template's edge cases.
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce, renderWebviewHtml } from '../../src/webviewHtml';

const CSP_SOURCE = "'self' https://*.vscode-cdn.net";

describe('createNonce', () => {
  it('returns 128 random bits in base64, different each call', () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});

describe('contentSecurityPolicy', () => {
  it('allows scripts only by nonce and blocks connections', () => {
    expect(contentSecurityPolicy(CSP_SOURCE, 'abc=')).toBe(
      "default-src 'none'; script-src 'nonce-abc='; " +
        "style-src 'self' https://*.vscode-cdn.net 'nonce-abc='; connect-src 'none'; " +
        "base-uri 'none'; form-action 'none'",
    );
  });

  it("with wasm, adds only 'wasm-unsafe-eval' to script-src (spec 011 criterion 9)", () => {
    expect(contentSecurityPolicy(CSP_SOURCE, 'abc=', { wasm: true })).toBe(
      contentSecurityPolicy(CSP_SOURCE, 'abc=').replace(
        "script-src 'nonce-abc='",
        "script-src 'nonce-abc=' 'wasm-unsafe-eval'",
      ),
    );
  });
});

describe('renderWebviewHtml', () => {
  const page = {
    cspSource: CSP_SOURCE,
    nonce: 'n0nce+/A==',
    title: '<a&b>.json',
    scripts: ['https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.js?a=1&b=2'],
    stylesheets: ['https://file+.vscode-resource.vscode-cdn.net/ext/dist/app.css'],
  };

  it('tags every script and stylesheet with the nonce and escapes text', () => {
    const html = renderWebviewHtml(page);
    expect(html).toContain(
      '<script nonce="n0nce+/A==" src="https://file+.vscode-resource.vscode-cdn.net/ext/dist/webview.js?a=1&amp;b=2"></script>',
    );
    expect(html).toContain(
      '<link rel="stylesheet" nonce="n0nce+/A==" href="https://file+.vscode-resource.vscode-cdn.net/ext/dist/app.css">',
    );
    expect(html).toContain('<title>&lt;a&amp;b&gt;.json</title>');
    expect(html).toContain(
      'content="default-src &#39;none&#39;; script-src &#39;nonce-n0nce+/A==&#39;;',
    );
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<link'));
  });

  it("puts 'wasm-unsafe-eval' in the page's policy only when asked (spec 011 criterion 9)", () => {
    expect(renderWebviewHtml(page)).not.toContain('wasm-unsafe-eval');
    expect(renderWebviewHtml({ ...page, wasm: true })).toContain(
      'script-src &#39;nonce-n0nce+/A==&#39; &#39;wasm-unsafe-eval&#39;;',
    );
  });

  it('rejects a nonce that could break out of the policy', () => {
    expect(() => renderWebviewHtml({ ...page, nonce: "x'; script-src *" })).toThrow(/base64/);
    expect(() => renderWebviewHtml({ ...page, nonce: '' })).toThrow(/base64/);
  });
});
