# DECISIONS — Architecture Decision Records (ADR)

> Each decision closes an UNKNOWN and becomes admissible evidence only after human confirmation
> (constitution §2 item 4). Record with ID, date, and the confirmation's origin.
>
> ADR-001…008 were proposed 2026-10-08 by the Architect thread "Plan extension architecture" and
> confirmed by the owner the same day (message ID on each). ADR-009 was confirmed by the owner (UNK-012). Specs may cite a
> proposed ADR as design intent, but no gate that depends on it is crossed before it is confirmed.
> New ADRs take the next free number on `main` (AGENTS rule 9). Delegated ADRs follow the rule in
> `spec/UNKNOWNS.md`'s header.

### ADR-001 — Editor engine: `vanilla-jsoneditor`
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** Build on `vanilla-jsoneditor` 3.x (ISC, Jos de Jong), the framework-agnostic build of `svelte-jsoneditor`.
- **Evidence:** npm registry `vanilla-jsoneditor@3.13.0` license `ISC`; README (github.com/josdejong/svelte-jsoneditor) lists tree/text/table modes, repair, transform, sort, schema validation; `index.d.ts` exports `createJSONEditor`, `createAjvValidator`, `parser`/`validationParser` props.
- **Consequences:** We own sync, formats, compare, CSV, theming. The library's default `JSON.parse` must be replaced via the `parser` prop for JSONC/JSON5 (spec 003).

### ADR-002 — Monorepo with a host-agnostic UI
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** pnpm monorepo `packages/{core, app-shell, sandbox, vscode-extension, chrome-app}`; hosts talk to the UI only through `HostAdapter`.
- **Evidence:** `docs/research/architecture.md` §Architecture, §Repo layout.
- **Consequences:** The Chrome app (spec 020) adds a host package, not a fork.

### ADR-003 — VS Code integration via `CustomTextEditorProvider`
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** The webview edits the real `TextDocument` through `WorkspaceEdit`s; VS Code owns save, undo, dirty state. Default-editor priority is decided separately in UNK-004.
- **Evidence:** `docs/research/feature-map.md` §Reusing svelte-jsoneditor, "Syncing with the file".
- **Consequences:** Git diff, other extensions and hot exit keep working; library undo must defer to VS Code.

### ADR-004 — Style-preserving edits for all three formats
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** Tree/table edits are applied as minimal text edits on a concrete syntax tree, never by re-stringifying. JSON/JSONC via `jsonc-parser`; JSON5 per ADR-009. Comment ownership rules come from UNK-008.
- **Evidence:** Owner message 2026-10-08 ("Make sure to support JSON, JSON5, JSONC formats"); `docs/research/feature-map.md` §Formats and current specs.
- **Consequences:** The golden-master corpus is the contract (spec 002).

### ADR-005 — Format spec targets
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** JSON = RFC 8259 (strict on write); JSONC = jsonc.org draft (trailing commas accepted on read, the file's existing style kept on write); JSON5 = 1.0.0; JSON Schema = 2020-12 and draft-07 (fallback per UNK-017); JSONPath = library's Goessner-style now, RFC 9535 engine in P2.
- **Evidence:** `docs/research/feature-map.md` §Formats and current specs (checked 2026-10-08).
- **Consequences:** No new format to support; the IETF JSON Schema draft is watched, not adopted.

### ADR-006 — Offline enforcement
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** All assets bundled; webview CSP `default-src 'none'` with nonce scripts, `style-src` limited to the webview source plus nonce, `connect-src 'none'`; eval only where ADR-010 places it; Ajv without `loadSchema`; no telemetry; CI fails on unexpected URLs or network requests.
- **Evidence:** `vanilla-jsoneditor@3.13.0/index.js` contains `new Function`; `docs/research/architecture.md` §Offline guarantees.
- **Consequences:** MV3-compatible design from day one; JS/Lodash queries wait for spec 011.

### ADR-007 — License and attribution
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** Our code MIT; `THIRD_PARTY_LICENSES.md` generated and shipped. README and About show exactly:
  > Inspired by JSON Editor Online (https://jsoneditoronline.org) by Jos de Jong. Built on his open-source svelte-jsoneditor library (ISC license). Not affiliated with or endorsed by JSON Editor Online.
  We do not reuse the site's name, logo or colours as branding.
- **Evidence:** npm license fields checked 2026-10-08; `docs/research/architecture.md` §Licensing.
- **Consequences:** Spec 005 criterion 1 greps for the quoted text.

### ADR-008 — Agent workflow
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08
- **Decision:** One task per thread/branch/PR; Implementer runs `skills/sdd-task-runner`; an independent Reviewer runs `skills/gate-review`; a `gate-review` CI check makes the Reviewer's PASS binding; the owner acts only at G0, G1, G2 and spec approvals.
- **Evidence:** `governance/multi-llm-workflow.md` §Handoff protocol; owner message 2026-10-08 ("the more automonous the better").
- **Consequences:** Most PRs merge without the owner; the owner's attention goes to gates and specs.

### ADR-009 — JSON5 style-preserving edits on our own parser
- **Date:** 2026-10-08 · **Human confirmation:** owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcid6Awk4uSNL6CcSHp29aijbr, 2026-10-08 ("Own parser" over momoa 3.3.13, after UNK-012 was escalated: its evidence rule allowed two readings)
- **Decision:** JSON5 edits run on our own recursive-descent JSON5 1.0.0 parser in `packages/core` (from `spikes/json5-cst/own-parser.ts`), which records UTF-16 offsets for every container, key and value; no JSON5 CST package is added. `json5` stays the reference for data and `stringify`.
- **Evidence:** `spikes/json5-cst/REPORT.md` and `results.md`: own parser 20/20 spike cases; `@humanwhocodes/momoa` 3.3.13 and `jsonc-eslint-parser` 3.3.0 19/20; `@croct/json5-parser` 0.2.2 16/20 (13/20 with its own writer); `json5` 2.2.3 6/20; `jsonc-parser` 3.3.1 1/20. Supporting: `conformance.md`, own parser 112/112 on json5-tests @ ceb24d4.
- **Consequences:** 002 T5 moves the parser into `core` with unit tests and json5-tests as a conformance fixture; no new runtime dependency or license entry. Reserved-word keys, `\u`-escaped keys, astral characters and U+2028 in strings are covered by our own tests rather than by an upstream package.

### ADR-010 — Eval location in VS Code: extension host
- **Date:** 2026-10-08 · **Confirmation:** delegated under UNK-011 ([Gate review 004-T1 PASS on PR #22](https://github.com/christian-vrl/chr-json-vscode-editor/pull/22#issuecomment-6065902379); authority: UNK-005 owner message cmsg_01Wz9SKzwQD2da69nuNGPcid3BtyRnySyH8Wa69pcGe3wL)
- **Decision:** In VS Code, code that needs eval (Ajv now, JS/Lodash queries in spec 011) runs in the extension host (option B). The webview receives results by message; its CSP keeps no `unsafe-eval` and gains no `frame-src`.
- **Evidence:** `spikes/eval-location/REPORT.md` and `results/` (spike 004 T1): in a custom editor webview with the 003 T4 CSP, a child frame loaded from `dist/` never loads (its navigation is not served locally and goes to the network), and srcdoc/blob: frames inherit the page CSP so eval throws, on VS Code 1.141.0 and 1.95.3; Ajv in the host validates a 1 MB document against a 200-rule schema with errors equal to a Node reference, in a median of ~17 ms per run in the spike's runs and ~24–26 ms in the Reviewer's reproduction (parse, validate and transfer to the webview included). The same frame bundle works as an MV3 sandbox page in Chromium 141.
- **Consequences:** 004 T2 builds validation in the extension host, results keyed by `docVersion`. `packages/sandbox` is not used by the VS Code extension; the Chrome app (spec 020) can use it as an MV3 sandbox page. Spec 011 must isolate user query code, which in the host would otherwise have Node's file and network access.

### ADR-011 — JavaScript and Lodash queries run in a sealed engine in the page
- **Date:** 2026-10-11 · **Human confirmation:** owner: Chris, thread decision card cmsg_01Wz9SKzwQD2da69nuNGPcid2uZwDWXSJpjQZcCE3hW5Ew, 2026-10-11 (UNK-048 "Sealed, in page"; it amends spec 003 criterion 6, AGENTS rule 7); spec 011 approved on card cmsg_01Wz9SKzwQD2da69nuNGPcidRscu3ZXKCSuEYXQLTudCUZ
- **Decision:** In every host, JavaScript and Lodash query text runs in QuickJS compiled to WebAssembly (`quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` 0.32.0, MIT), one fresh runtime per run with a 5 s deadline and a 256 MiB memory limit, called synchronously from the editor page through the library's `QueryLanguage.executeQuery`. The CHR JSON editor webview's `script-src` gains `'wasm-unsafe-eval'` and nothing else; `'unsafe-eval'` stays out of every page. Ajv stays where ADR-010 put it.
- **Evidence:** `spec/011-js-queries/spec.md` §Current evidence: the library calls `executeQuery` synchronously (`vanilla-jsoneditor@3.13.0/index.d.ts:280-286`); a child frame with its own CSP does not load in a VS Code webview (`spikes/eval-location/REPORT.md` §3); Node's `vm` is not a security mechanism; the QuickJS sandbox check of 2026-10-11 (no host objects, deadline and memory limit stop runs, 0.4 s for a 5 MiB query). In-webview behavior is verified by 011 T1 before the rest is built.
- **Consequences:** Supersedes ADR-010 for queries only (its "JS/Lodash queries in spec 011" in the host). ADR-006's "eval only where ADR-010 places it" now reads "JavaScript eval only where ADR-010 places it; WebAssembly compilation only for ADR-011's engine". 003 criterion 6's check allows `'wasm-unsafe-eval'` in the editor webview only. Specs 013 (vscode.dev) and 020 (Chrome MV3, which allows `'wasm-unsafe-eval'` on extension pages) reuse the engine; `packages/sandbox` is not needed for queries.
