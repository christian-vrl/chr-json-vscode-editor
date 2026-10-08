# DECISIONS — Architecture Decision Records (ADR)

> Each decision closes an UNKNOWN and becomes admissible evidence only after human confirmation
> (constitution §2 item 4). Record with ID, date, and the confirmation's origin.
>
> ADR-001…008 were proposed 2026-10-08 by the Architect thread "Plan extension architecture" and
> confirmed by the owner the same day (message ID on each). ADR-009 and ADR-010 are reserved. Specs may cite a
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

### ADR-009 — JSON5 style-preserving approach (reserved)
- Filled by 002 T4 under UNK-012.

### ADR-010 — Eval location in VS Code: extension host
- **Date:** 2026-10-08 · **Confirmation:** delegated under UNK-011 ([Gate review 004-T1 PASS on PR #22](https://github.com/christian-vrl/chr-json-vscode-editor/pull/22#issuecomment-6065902379); authority: UNK-005 owner message cmsg_01Wz9SKzwQD2da69nuNGPcid3BtyRnySyH8Wa69pcGe3wL)
- **Decision:** In VS Code, code that needs eval (Ajv now, JS/Lodash queries in spec 011) runs in the extension host (option B). The webview receives results by message; its CSP keeps no `unsafe-eval` and gains no `frame-src`.
- **Evidence:** `spikes/eval-location/REPORT.md` and `results/` (spike 004 T1): in a custom editor webview with the 003 T4 CSP, a child frame loaded from `dist/` never loads (its navigation is not served locally and goes to the network), and srcdoc/blob: frames inherit the page CSP so eval throws, on VS Code 1.141.0 and 1.95.3; Ajv in the host validates a 1 MB document against a 200-rule schema with errors equal to a Node reference, in a median of ~17 ms per run in the spike's runs and ~24–26 ms in the Reviewer's reproduction (parse, validate and transfer to the webview included). The same frame bundle works as an MV3 sandbox page in Chromium 141.
- **Consequences:** 004 T2 builds validation in the extension host, results keyed by `docVersion`. `packages/sandbox` is not used by the VS Code extension; the Chrome app (spec 020) can use it as an MV3 sandbox page. Spec 011 must isolate user query code, which in the host would otherwise have Node's file and network access.
