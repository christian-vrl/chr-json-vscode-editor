# SPEC INDEX — CHR JSON Editor

> Project addition to the kit: the map agents read first. Priorities come from
> `docs/research/feature-map.md`. Each spec's state lives only in its own `Status` line.

## Human gates (the only stops that need Chris)

| Gate | When | What Chris does |
|---|---|---|
| **G0** | Done 2026-10-08 | Answer `UNKNOWNS.md` rows with decider *owner* (or "approve all recommendations"), confirm ADR-001…008, approve specs 001–005, create the empty repo (001 T0) |
| **Spec approval** | Each P1/P2 spec | Approve the spec an Architect thread wrote |
| **G1** | 003 T1–T11 merged | Install the preview `.vsix` from CI and try it; reply "G1 pass" or list issues |
| **G2** | 005 T1–T2 merged | Create publisher accounts, add secrets, approve the `release` environment run |

## v1 (P0)

| Spec | Title | Depends on | Implementer tier |
|---|---|---|---|
| 001-foundation | Repo foundation and CI guards | G0 | Medium |
| 002-formats-core | JSON, JSONC, JSON5 with style-preserving edits | 001 T4 | Large for T1, T4, T6; Medium otherwise |
| 003-vscode-editor | VS Code custom editor | 001 T5–T6; task-level `needs:` on 002 | Medium |
| 004-schema-validation | Offline JSON Schema validation | task-level `needs:` on 003 and 002 | Large for T1; Medium otherwise |
| 005-release | v1 release | 002–004 done, G1 | Medium; owner at G2 |

Cross-spec task dependencies are written on each task as `needs: <NNN> <Tn>`. Within a spec,
tasks run in order unless marked `parallel`.

**What runs at once after 001:** 002 T1, T2 and the T4 spike · 003 T1–T4 · then (after 003 T4) the 004 T1 spike.

## P1 — an Architect thread writes each spec; owner approves; then it runs like v1

| Spec | Title | Notes |
|---|---|---|
| 006-convert-formats | Convert between JSON, JSONC, JSON5 with lossy-step warnings | 002 token streams; keeps layout and comments (UNK-033) |
| 007-structural-compare | Structural compare (two files or vs Git HEAD, ignoring key order) | reuses 002 T9 `diff`; 006 and 007 can run in parallel |
| 008-large-file-mode | Large-file mode: read-only tree and table above 5 MiB, lighter parse, 50 MB ceiling message | threshold 5 MiB (UNK-014); behavior per UNK-040; can run in parallel with 006 and 007 |
| 009-csv | CSV import and export with options and preview, csv42's field-name notation | own code in `core`; replace document data via 002 R14 (UNK-042); can run in parallel with 007 and 008 |
| 010-smart-format | Smart format: short arrays and objects on one line, tables, keeping keys, values and comments as written | FracturedJson 5.1.0 (MIT), as the site uses; key order per UNK-045, trailing commas per UNK-046, fixed options per UNK-047; off above 5 MiB; can run in parallel with 007–009 |
| 011-js-queries | JavaScript and Lodash queries in the Transform dialog, run in a sealed engine (QuickJS) inside the page | eval location per ADR-011 / UNK-048 (amends 003 criterion 6 by `'wasm-unsafe-eval'`); above 5 MiB per UNK-049; can run in parallel with 007–010 |
| 012 | NDJSON / JSON Lines in table mode | |
| 013 | vscode.dev (web extension) build | |

## P2 — backlog

014 RFC 9535 JSONPath · 015 Lossless big numbers · 016 Generate JSON Schema · 017 YAML/TOML/XML import ·
018 Copy path / reveal node · 019 Settings · 020 Chrome offline app: MV3 extension page and installable PWA from one build (UNK-009)

## How an agent picks work

1. Read `AGENTS.md`, then this file.
2. Take the first `[ ]` task in a spec whose Status is `approved (owner: …)`, whose `needs:` tasks
   are `[x]` on `main`, whose earlier tasks in the same spec are `[x]` (unless marked `parallel`),
   and that has no remote branch `t/<NNN>-<Tn>`.
3. Follow `skills/sdd-task-runner/SKILL.md`.
