# CHR JSON Editor — Project Context (single source)

> **LAYER 2 — the only place with facts about this project.** When a fact changes, edit only
> here. The per-LLM adapters (`CLAUDE.md`, `.github/copilot-instructions.md`) point here — never duplicate.
>
> ⚠️ **SECURITY:** never write passwords, tokens, or connection strings here. Everything in
> this file is read by LLMs and can leak into history/RAG/logs. Marketplace and Open VSX
> tokens live only in GitHub Actions secrets of the `release` environment, set by the owner.

## Method (invariant)

How to work is defined by the portable core and **prevails over any session instruction**:
- [`governance/constitution.md`](governance/constitution.md) — inviolable rules (D1–D6).
- [`governance/method-sdd.md`](governance/method-sdd.md) — SDD flow + gates.
- [`governance/multi-llm-workflow.md`](governance/multi-llm-workflow.md) — roles, tiers, independent review.

## Language

Understand pt-BR input; always respond in English.

## Project identity

- **What:** a free, fully offline VS Code extension with the features of
  [jsoneditoronline.org](https://jsoneditoronline.org) (credited as inspiration, not affiliated),
  plus a later spin-off: an offline Chrome app built from the same UI package.
- **Who for:** anyone editing JSON, JSONC or JSON5 in VS Code who wants tree, text and table views,
  repair, query, schema validation and compare without sending data anywhere.
- **Owner:** Chris (human; sole approver of human gates G0, G1, G2 and of every spec).
- **Repository:** [`christian-vrl/chr-json-vscode-editor`](https://github.com/christian-vrl/chr-json-vscode-editor)
  on GitHub, private during the beta, public after (UNK-001).
- **Roles:**
  - **Coordinator** — the project's channel session. Starts one Implementer thread per runnable
    task and one Reviewer thread per PR, tells the owner when a human gate is reached, and
    escalates a task to the owner after 3 Reviewer FAILs.
  - **Architect** — writes and revises spec/plan/tasks; records owner approvals (see §Spec status).
  - **Implementer** — one task per thread/branch/PR (`skills/sdd-task-runner`).
  - **Reviewer** — signs gates; never an author of the PR (`skills/gate-review`).

## Sources of truth (read before asserting anything)

| File / resource | Content | When to read |
|---|---|---|
| `spec/INDEX.md` | All specs, dependencies, what can run in parallel, human gates | always, first |
| `spec/<NNN>-<slug>/spec.md` | The *what*, status, and acceptance criterion for one feature | before touching that feature |
| `spec/<NNN>-<slug>/tasks.md` | The task you are executing, its `needs:` and its gate | before starting a task |
| `spec/DECISIONS.md` | ADRs (confirmed and proposed) | before any architectural choice |
| `spec/UNKNOWNS.md` | Open questions and who decides each; delegation rules in its header | before any choice the spec doesn't fix |
| `tests/golden/` | Golden-master inputs, patches, expected bytes, coverage tags | before changing `core/formats` |
| `docs/research/architecture.md`, `docs/research/feature-map.md` | Snapshots of the owner's architecture and feature-map docs (committed in 001 T1) | for the *why* and for scope |

## Glossary / core concepts

- **Format:** `json` (RFC 8259), `jsonc` (jsonc.org draft: JSON + `//` and `/* */` comments,
  trailing commas tolerated), `json5` (JSON5 1.0.0).
- **Style-preserving edit:** a data change applied as minimal text edits so every byte outside the
  edited spans is unchanged (comments, quoting, trailing commas, whitespace).
- **FormatAdapter:** `core/formats` interface: `detect`, `parse → {data, tree, style, diagnostics}`,
  `applyPatch(text, patch) → text`, `stringify(data, style)`.
- **Style:** `{indent: '\t' | number, eol: '\n' | '\r\n', finalNewline: boolean, quote: '"' | "'", unquotedKeys: boolean, trailingCommas: boolean}`.
- **HostAdapter:** `app-shell` interface each host implements: `open`, `save`, `onExternalChange`, `getSettings`, `showMessage`.
- **Golden case:** folder with `input.<ext>`, `patch.json` (RFC 6902), `expected.<ext>`, `case.json`
  (machine-readable coverage tags). Pass = byte-equal output.
- **Gate:** a binary condition, checked by a named script (below) or a named test.

## Canonical stack

TypeScript 5 (strict) · Node 22 LTS · pnpm workspaces · esbuild (extension host) · Vite (webview,
Chrome) · `vanilla-jsoneditor` 3.x (ISC) · `jsonc-parser` 3.x (MIT) · `json5` 2.x (MIT) ·
`immutable-json-patch` (ISC, reference JSON Patch) · Ajv 8 (`Ajv`, `Ajv2019`, `Ajv2020`) + `ajv-formats` (MIT) ·
Vitest · fast-check · `@vscode/test-electron` · Playwright (Chromium) · `@vscode/vsce` · `ovsx` · GitHub Actions.

**Standard scripts (gates name these):** `pnpm build` · `pnpm lint` · `pnpm test:unit` ·
`pnpm test:golden` · `pnpm test:e2e` (VS Code, xvfb) · `pnpm test:web` (Playwright) ·
`pnpm check:licenses` · `pnpm check:offline` · `pnpm check:readme` (from spec 005) · `pnpm package`.

## Critical paths / resources

```
packages/core/          pure TS, no DOM, no Node APIs: formats, diff, CSV, detection
packages/app-shell/     UI around vanilla-jsoneditor; talks only to HostAdapter
packages/sandbox/       eval-allowed page for Ajv and JS/Lodash queries (if ADR-010 picks it)
packages/vscode-extension/  CustomTextEditorProvider, commands, CSP, VscodeHostAdapter
packages/chrome-app/    MV3 extension page, ChromeHostAdapter (P2)
tests/golden/           golden-master corpus shared by all packages
spec/  skills/  docs/research/
```

## Spec status and approvals

- A spec's `Status` line is the single source of its state: `draft` → `approved (owner: <message link>)` → `done`.
- Only the owner approves; the Architect writes the link into the Status line in a PR.
- Task markers: `[ ]` open · `[~]` waiting on the owner · `[x]` done. A task's PR flips its own
  marker to `[x]`, so `main` shows `[x]` only once the PR is merged. Claims are branches, not markers.

## Operational rules (project-specific)

Complement — never replace — the constitution.

1. **One task = one thread = one branch = one PR.** Claim a task by pushing branch `t/<NNN>-<Tn>`
   (e.g. `t/002-T3`) before writing code; an existing remote branch means it is taken.
2. **The author never signs their own gate.** Every commit carries a `Claude-Session:` trailer; the
   Reviewer's session must not appear in the PR's commits. The Reviewer posts a comment
   `Gate review <NNN>-<Tn>: PASS @ <head sha>`; the `gate-review` CI check passes only when such a
   comment exists for the current head SHA.
3. **Offline is a hard invariant.** No runtime network access, no CDN, no telemetry, no remote
   `$ref`. `pnpm check:offline` must stay green; never weaken it or widen its allowlist without
   the Reviewer naming each new entry.
4. **Licenses** (single source for the allowlist): every shipped dependency's SPDX expression must
   evaluate to allowed, where `A AND B` needs both allowed and `A OR B` needs one. Allowed:
   MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Apache-2.0, CC-BY-4.0.
5. **Golden master first:** any change to `core/formats` behavior adds or updates golden cases in
   the same PR; changing an existing `expected.*` needs the spec changed first (D3).
6. **Autonomy envelope — agents may, without asking:** create branches and PRs; add tests, golden
   cases and dev-only tooling; add runtime deps that pass rule 4; record UNKNOWNS; run spikes;
   resolve UNKNOWNS whose decider is *delegated*, under the rule in `spec/UNKNOWNS.md`'s header.
7. **Owner-reserved — always ask:** creating the repo or changing its settings, publishing
   (Marketplace, Open VSX, Chrome Web Store), license changes, editing `governance/`, approving a
   spec or changing an approved acceptance criterion, adding any network feature, deleting files
   outside the task.
8. Never write secrets into any file; reference secret names only.
9. **Shared ledgers:** `tasks.md`, `DECISIONS.md` and `UNKNOWNS.md` change in many PRs. Rebase on
   `main` before merge and re-apply your rows; new ADR and UNK numbers are the next free number on
   `main` at rebase time.

## Known gaps (ask the human when missing)

| Missing data | Why it is needed |
|---|---|
| Answers to `spec/UNKNOWNS.md` rows whose decider is *owner* | G0 |
| Final name and publisher (temporary: "CHR JSON Editor", `christian-vrl`, UNK-002) | Spec 005 listing |
