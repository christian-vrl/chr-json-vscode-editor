# Spike 004 T1: where can eval run? (UNK-011, ADR-010)

> **Result:** option A (sandboxed child frame in the webview) does **not** validate under the real
> webview CSP on VS Code 1.141.0 or 1.95.3; option B (extension host) does. Per UNK-011's
> evidence rule, **B**. Spec 004 T2 implements B; spec 011 (JS/Lodash queries) reuses it.
> The same frame bundle **does** work as an MV3 sandbox page, so the Chrome app (spec 020) can use
> option A there.

## 1. The rule, and how this spike reads it (written before measuring)

UNK-011's evidence rule: *"pick the sandbox iframe (A) if spike 004-T1 shows it validates under
the real webview CSP; else extension host (B)."*

How it is read here:

- **"the real webview CSP"**: the policy 003 T4 ships (`contentSecurityPolicy()` in
  `packages/vscode-extension/src/webviewHtml.ts`, imported by the spike, not copied), in a
  `CustomTextEditorProvider` webview with 003 T4's options (`enableScripts: true`,
  `localResourceRoots` = the extension's `dist/` only). Spec 003 criterion 6 must stay true: every
  variant's policy is checked with the CSP rules of `packages/vscode-extension/test/e2e/suite.cjs`
  `assertCriterion6`. Option A cannot load any frame under `default-src 'none'`, so the reading
  allows **one added directive, `frame-src <webview.cspSource>`**: criterion 6 does not mention
  `frame-src`, and the existing check already allows any fetch directive that names only the
  webview source. Nothing else may change; `unsafe-eval` stays out of the page.
- **"validates"**: Ajv (spec 004 criterion 2's options: `strict: false`, `allErrors: true`,
  `ajv-formats`, no `loadSchema`) compiles the benchmark schema and validates the benchmark document
  inside the frame, and the reported `[{instancePath, keyword}]` list equals a plain-Node run of the
  same code on the same bytes.
- Time and MV3 reuse are recorded as the task asks; they are not inputs to the rule.

**Second reading considered:** "the real webview CSP" means 003 T4's policy byte for byte. Then no
frame loads at all (variant `iframe-src-unchanged-csp` below) and the rule gives B by construction.
This was sent to the coordinator before measuring. **It does not matter:** A fails under both
readings (§3), so both give B.

## 2. What was measured

Code: this folder (dev-only workspace package `chr-json-editor-spike-eval-location`; nothing in it
ships or is bundled into the extension).

| File | Role |
|---|---|
| `fixture.mjs` | Deterministic benchmark: draft-07 schema with exactly **200 rules** (one rule = one assertion keyword; counted and checked) and a **1,000,791-byte** document (775 objects × 39 properties, ~1% invalid → 12 errors). SHA-256 `33c244ab807d48b4d975e0e149f42229de51433d262f1e9bb0f14a9d4d05c32d`. |
| `src/ajv-runner.ts` | The one Ajv routine every location runs. |
| `src/extension.ts`, `src/page.ts` | Spike custom editor + webview script (nonce-loaded classic script, like 003 T4's). |
| `src/sandbox.ts`, `dist/sandbox.html` | Option A's frame: its own CSP `default-src 'none'; script-src https://*.vscode-cdn.net 'unsafe-eval'; connect-src 'none'`. |
| `suite.cjs`, `run.mjs` | Opens the document once per variant inside VS Code and writes `results/vscode-<version>.json`. |
| `src/node-reference.ts` | The Node reference errors. |
| `mv3.mjs`, `src/mv3-page.ts` | MV3 check in Chromium; writes `results/mv3-chromium.json`. |

Variants, each a fresh webview on the same document:

| Variant | Page CSP | Where Ajv runs |
|---|---|---|
| `main-frame` (control) | 003 T4 as is | the editor page itself |
| `iframe-src-unchanged-csp` | 003 T4 as is | child frame `src` = `asWebviewUri(dist/sandbox.html)`, `sandbox="allow-scripts"` |
| `iframe-src` (**option A**) | 003 T4 + `frame-src <cspSource>` | same frame |
| `iframe-src-unsandboxed` | 003 T4 + `frame-src <cspSource>` | same frame without the `sandbox` attribute |
| `iframe-srcdoc` | 003 T4 as is | `srcdoc` frame, nonce'd inline eval probe + `sandbox.js` |
| `iframe-blob` | 003 T4 + `frame-src blob:` (breaks criterion 6; recorded only) | `blob:` frame, same content |
| `host` (**option B**) | 003 T4 as is | extension host; the page asks, receives the errors |

Environment: Linux x64 under `xvfb-run`; VS Code from packages.microsoft.com `.deb`s (the update
server is blocked here) — **1.141.0** (Electron 43.7.7, Chromium 150, Node 24.21) and **1.95.3**
(Electron 32.2.1, Chromium 128, Node 20.18; the `^1.95.0` floor). MV3: Playwright's Chromium
141.0.7390.37, headless.

## 3. Results

Raw data: `results/vscode-1.141.0.json`, `results/vscode-1.95.3.json`, `results/mv3-chromium.json`.
Times are medians of 5 runs, in ms; "per validation" = from asking to errors in the page,
including `JSON.parse` of the 1 MB text and the message transfer.

### Required record

| | Validates under the real CSP | Time for 1 MB × 200 rules | Reusable as an MV3 sandbox page |
|---|---|---|---|
| **A** sandbox frame | **No** (1.141.0 and 1.95.3; see below) | not measurable in VS Code (never ran). In the MV3 page: compile 50 ms, per validation 62 ms (Ajv itself 11 ms) | **Yes**: same `sandbox.js` and same `sandbox.html`, listed under `sandbox.pages`, errors equal the Node reference |
| **B** extension host | **Yes**: errors equal the Node reference (12), page CSP unchanged, no violations | 1.141.0: compile 103 ms, per validation **17.0 ms** (Ajv 12.6 ms). 1.95.3: compile 63 ms, per validation **17.6 ms** (Ajv 12.4 ms) | **No**: Chrome has no extension host. Its Ajv code is host-neutral and runs unchanged in the MV3 sandbox page above |

Node reference, same machine: compile 50–62 ms, parse + validate 14–35 ms.

### Why A fails (identical on both VS Code versions)

| Variant | Outcome | Evidence |
|---|---|---|
| `main-frame` | EvalError | CSP violation `script-src` / `eval`: the 003 T4 policy works as intended. |
| `iframe-src-unchanged-csp` | frame blocked | violation `frame-src` for `https://file+.vscode-resource.vscode-cdn.net`; VS Code log `ERR_BLOCKED_BY_CSP`. |
| `iframe-src` (A) | frame never loads | No CSP violation, but VS Code logs `Failed to load URL: https://file+.vscode-resource.vscode-cdn.net/…/dist/sandbox.html with error: ERR_TUNNEL_CONNECTION_FAILED`: the frame's navigation went to the **network** (this sandbox's proxy) instead of being served locally. |
| `iframe-src-unsandboxed` | same as `iframe-src` | so the `sandbox` attribute is not the cause. |
| `iframe-srcdoc` | eval blocked | the inline probe throws `EvalError … script-src 'nonce-…'`: the frame inherited the page's policy. `sandbox.js` never arrives. |
| `iframe-blob` | eval blocked | same inherited-policy EvalError; and `frame-src blob:` already fails criterion 6. |

Reading of these results (inference, not separately measured): VS Code serves
`localResourceRoots` through the webview's service worker, which answers requests made *by the
webview page*. A child frame's navigation is a new document request that worker does not handle,
so it leaves the machine; and the frame kinds that need no request (srcdoc, blob:) inherit the
page's CSP, which by design has no `unsafe-eval`. No frame kind in a VS Code webview gets both
local content and its own eval-allowing policy. Besides failing the rule, A would also have broken
the offline invariant (AGENTS.md rule 3) by sending a request for a local file path to
`vscode-cdn.net`.

### MV3 detail

| Frame page | Validates | Note |
|---|---|---|
| `sandbox.html` (the VS Code file, byte for byte) | yes | its `<meta>` CSP names `vscode-cdn.net`, yet the `chrome-extension:` script loads (inference: Chromium exempts the extension's own scheme from page CSP). |
| `sandbox-plain.html` (no `<meta>` CSP) | yes | the manifest's default sandbox CSP alone. |
| `sandbox-unlisted.html` (negative control, not in `sandbox.pages`) | no | `EvalError … script-src 'self'`: the extension-page CSP; shows the check can fail. |

## 4. Decision and consequences

- **UNK-011 → B (extension host)**, by the rule as read in §1 and by the stricter reading too.
  Filled into ADR-010.
- 004 T2: Ajv runs in the extension host; the webview gets errors keyed by `docVersion` and feeds
  them to the library's `validator` prop (plan 004 risk R2). The webview CSP is unchanged.
- `packages/sandbox` is not used by the VS Code extension. It stays for the Chrome app (spec 020),
  where the MV3 sandbox page works as measured above. Removing or keeping that skeleton is left to
  spec 020; this spike deletes nothing.
- Spec 011 (JS/Lodash queries) runs user code in the extension host by this decision. That code
  then has Node's powers (file system, network), unlike a sandboxed frame; spec 011 must isolate it
  (for example `node:vm` in a separate process or a worker) and its spec should say so. Recorded
  here as a consequence, not decided.

## 5. Reproduce

```sh
pnpm install
# VS Code (needs a display; VS Code from VSCODE_EXECUTABLE_PATH or downloaded by @vscode/test-electron)
VSCODE_EXECUTABLE_PATH=/path/to/code xvfb-run -a pnpm --filter chr-json-editor-spike-eval-location spike
# MV3 (Playwright's Chromium; PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use another build)
pnpm --filter chr-json-editor-spike-eval-location spike:mv3
```

Both commands rebuild the spike, regenerate the fixture (same SHA-256), and overwrite `results/`.
Times vary by machine; the yes/no outcomes and error lists should not.
