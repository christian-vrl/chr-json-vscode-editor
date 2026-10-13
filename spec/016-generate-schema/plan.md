# PLAN 016 — Generate JSON Schema

> Derives from spec `016`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
The generator is a pure function in `core` (`packages/core/src/schema/generate.ts`), exported from
`@chr-json-editor/core`, so the extension host, the web build and a later Chrome app share it.
One pass over the data fills an accumulator per schema position (the set of types seen, a
`Map` of keys with how many objects held each, one accumulator for all array elements); a
second pass writes the schema object in G6 order. Keys are written with
`Object.defineProperty` so `__proto__` stays an own key, and the walk uses an explicit stack, so
G9's 1,000-level check is a counter rather than a stack overflow. No dependency: the sandbox
prototype is 40 lines and the rules are ours to fix in the corpus.

The command lives in `packages/vscode-extension`: it reads the document text, runs `parseData` (no
parse cache, cheap on large files, spec 008), calls the generator and writes the schema file the
way the convert command writes its output (spec 006, UNK-035): `workspace.fs` beside the source,
so it works on virtual file systems in the web host too. It needs no webview change: the host has
the text in every tab, locked large-file tabs included.

The validator change is one option in `compileSchema` (`ownProperties: true`), tested against the
existing fixtures first, so spec 004's results stay as they were except for inherited keys.

## Constraints / invariants
- No overwrite without snapshot/backup (D4): the command never writes over an existing file
  without the save dialog, and never changes the source.
- Offline (AGENTS rule 3): the generator writes `$schema` URIs only; nothing is fetched.
- `core` stays free of DOM and Node APIs (spec 013); the command uses `workspace.fs`, not `fs`.
- The schema depends only on the source data (G7), never on the text's style.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Corpus and generator | `tests/schema-gen/`, `generate.ts`, coverage test | criteria 1, 2 |
| B | Validator fix and self-validation | `ownProperties: true`, property suite | criteria 3, 4 |
| C | Command | e2e fixtures, menus, link button | criteria 5–7 |
| D | JSON Lines, large files, bench | e2e on `.jsonl` and 008's fixtures, `bench/RESULTS.md` rows | criteria 8, 9 |
| E | Web | web e2e case, 013 coverage map | criterion 10 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 `ownProperties: true` changes results users rely on | criterion 4 runs every `tests/schema/` fixture before and after; only inherited-key false errors go away |
| R2 A map-like object with many keys gives a huge schema | correct by G3 and listed in §Out; the bench's records keep the size small; a later options dialog can add map detection |
| R3 Writing workspace settings surprises the user | only on the button's click (UNK-070), one appended entry, existing entries kept |
| R4 The schema file name collides with an existing one | save dialog prefilled, as spec 006 does |

## Definition of Done
1. Criteria 1–11 green in CI.
2. UNK-069 and UNK-070 resolved; spec 004 criterion 2 amended in its spec file (by this spec's PR, on approval).
3. README (spec 005) names the command in one line.
