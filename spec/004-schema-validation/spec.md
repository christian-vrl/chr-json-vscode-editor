# SPEC 004 — Offline JSON Schema validation

> **Status:** `approved (owner: Chris, thread message cmsg_01Wz9SKzwQD2da69nuNGPcidEGps3h6QkUAkZLe48ZhPH2, 2026-10-08)`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
Schema validation is P0 and must work with no network. Ajv compiles schemas with `new Function`,
which the main webview CSP forbids (ADR-006), and remote `$ref` loading would break offline use.

## Goal
Documents in all three formats are validated against a locally found JSON Schema, with errors shown
inline in tree, table and text modes, and with zero network access.

## Acceptance criterion (falsifiable)
1. **Association**, first match wins: the document's top-level `$schema` value when it is a relative or
   absolute local path → VS Code `json.schemas` setting (`fileMatch`) → `json5.schemas` setting → none.
   Table-driven test of each rule.
2. **Dialect** is chosen from the *schema's own* `$schema` per UNK-017 (missing → draft-07, and the UI shows "assumed draft-07" with a switch). For each fixture in
   `tests/schema/<dialect>/<case>/` (`schema.json`, `doc.*`, `expected-errors.json` as
   `[{instancePath, keyword}]` sorted), the reported errors equal the expected list. Ajv runs with
   `strict: false`, `allErrors: true`, and `ajv-formats` added.
3. A schema with `$ref: "https://…"` reports "Remote schema references are not loaded (offline)"; the
   network-blocked test records zero requests.
4. The main webview CSP still has no `unsafe-eval` (spec 003 criterion 6 stays green).
5. Errors appear inline in tree, table and text modes for `.json`, `.jsonc` and `.json5` fixtures (e2e).

## Scope
- **In:** association, dialect selection, bundled meta-schemas, eval location per ADR-010, inline errors.
- **Out:** schema generation (016), downloading schemas (never; offline).

## Current evidence (D2 — path + lines / section)
- ADR-005, ADR-006. `vanilla-jsoneditor@3.13.0` exports `createAjvValidator` and `createAjvValidatorAsync` (`index.d.ts`).
- `json5.schemas` is the setting of the "Better JSON5" extension per `docs/research/feature-map.md` §Formats — HYPOTHESIS until T3 confirms it from that extension's `package.json`.

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-011 | Where eval runs | T2 | delegated (T1 evidence) |
| UNK-017 | Fallback dialect | T4 | see ledger |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [x] Human approval recorded (G0)
