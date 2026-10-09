# PLAN 006 — Convert between JSON, JSONC and JSON5

> Derives from spec `006`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
Corpus first, as in 002: the golden cases for C1–C7 are written and reviewed before `convert`, so
they are the contract. `convert` is a single pass over the source format's token stream (`tokenize`
for JSON and JSONC, `parseJson5(...).tokens` for JSON5): each token is either copied or replaced by
the rule that names it, and every comment or value it cannot carry is recorded as a loss. The data
check of criterion 4 runs on the result, so a rule that changed data fails the property suite rather
than reaching a user. Superset pairs (`json-to-jsonc`, `json-to-json5`, `jsonc-to-json5`) return the
input unchanged.

The VS Code side is one command per target format, registered in the extension host; it reads the
document text, calls `convert`, shows the loss modal when `losses` is not empty, then writes the
result per UNK-035. The webview and its message protocol do not change.

This approach follows UNK-033 (owner: ★, keep layout and comments), so `convert` does not use
002 T7's `stringify`.

## Constraints / invariants
- `core` stays pure TypeScript with no DOM and no Node APIs; `convert` is exported from `@chr-json-editor/core`.
- No `expected.*` file changes without a spec change (AGENTS rule 5); the new corpus folder
  `tests/golden/convert/` is added to `.prettierignore` like the other golden folders.
- The source document is never modified: UNK-035 (owner: ★) writes a new file beside it.
- No network, no new runtime dependency (hex to decimal uses `BigInt`).
- No overwrite without snapshot/backup (D4): all work in branches.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Golden corpus + coverage test | cases with `case.json` and `losses.json` | criterion 2 green; Reviewer checks every case against C1–C7 |
| B | `convert` in core | `packages/core/src/formats/convert.ts`, property suite | criteria 1, 3, 4, 5 |
| C | Commands | command, modal, write per UNK-035, e2e | criteria 6, 7, 8 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 `jsonc-parser`'s scanner tolerates input the JSONC adapter later rejects | criterion 4 parses every output with the target adapter; a failing seed becomes a golden case |
| R2 C5 leaves odd spacing (a block comment between two tokens on one line) | golden cases for comments inline, before and after a member pin the bytes |
| R3 A JSON5 string re-encoded by C1 changes an escape the user wanted kept | C1 replaces only strings that are not valid JSON; valid ones keep their escapes (C7), checked by criterion 5 |
| R4 Large documents | one linear pass with no re-parse per token; measured on the 002 bench documents in T2 and recorded in the PR |

## Definition of Done
1. Criteria 1–8 pass in CI. 2. UNK-033, UNK-034 and UNK-035 resolved before T1 starts (all three resolved by the owner, 2026-10-09).
