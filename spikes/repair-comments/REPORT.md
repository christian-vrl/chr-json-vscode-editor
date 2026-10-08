# Spike 002 T11 — Repairing broken JSONC/JSON5 while keeping comments (UNK-018)

**Result:** comments can be kept. Both engines measured here keep every comment, at its anchor, on
**20 of 20** broken commented fixtures, under both readings of the rule below (A and B); plain
`jsonrepair` keeps none. Both readings clear the ≥ 18 bar, so the ambiguity does not change the
outcome, and UNK-018 resolves under its delegation rule to **keep comments**. Recommended engine:
**T** (tagged whitespace), which is linear in file size. Separately, `jsonrepair` changes JSON5 data
while it repairs, whether or not there are comments; that is recorded as UNK-028 for the owner.

## How this report reads UNK-018's rule (written before the run)

This section is unchanged from `fe95ad6`, where it was committed with the fixtures before any
engine code existed.

The rule: "keep comments if spike 002-T11 keeps every comment on ≥ 18 of 20 broken commented
fixtures; otherwise repair asks before removing comments that are not attached to removed keys".

1. **A fixture counts as kept (reading B, the one this report applies)** when all three hold:
   - the repaired text parses without errors in the fixture's format (`jsonc-parser` for JSONC,
     `json5` for JSON5);
   - its data deep-equals plain `jsonrepair` on the same input, so keeping comments does not change
     what the repair does (otherwise "not repairing" would trivially keep every comment);
   - every input comment appears in the output byte-identical, in the same order, at the anchor
     written by hand in the fixture's `case.json` before the engine existed (same container, same
     number of members before it, same "trailing on the previous member's line" flag; see
     [`fixtures/README.md`](fixtures/README.md)).

   Why anchors: spec 002 R5/R13/R14 and UNK-008 define a comment by the member it is attached to,
   the task line names "re-anchor" as a step, and a comment moved onto another member would
   mislead the reader.
2. **Second reasonable reading (A):** "keeps" means only that every comment's text is present, in
   order, with the same parse and data conditions, and no anchor check. The run reports the count
   under both readings. If both land on the same side of 18, the difference does not change the
   outcome and UNK-018 is resolved under the delegation rule; if they split, UNK-018 is escalated
   to the owner, as 002 T4 did for UNK-012.
3. **Fixture choice** is not fixed by the rule (who writes them, which breakages). This spike's
   choice is in [`fixtures/README.md`](fixtures/README.md); the Reviewer judges whether it is fair.
4. **Not decided by the rule:** if the spike passes, what the product does on a file in the
   failing minority. §Consequences gives a proposal, marked as such.

## Method

1. **Fixtures first.** 20 broken files (10 JSONC, 10 JSON5), each broken in one way from the
   `jsonrepair` 3.15.0 README's list of repairs (missing commas, unquoted keys, single and
   typographic quotes, truncation, Python constants, Markdown fences, JSONP, string concatenation,
   ellipsis, MongoDB types, plus unquoted and unclosed strings), 42 comments in all, with at least
   one comment next to each break and `//` inside strings in two of them. Their hand-written anchors
   are in each `case.json`. All were committed in `fe95ad6` and have not changed since
   (`git diff fe95ad6 HEAD -- spikes/repair-comments/fixtures` is empty).
2. **Two engines** share one comment scanner ([`scan.ts`](scan.ts)) that knows the string forms
   `jsonrepair` accepts (`"…"`, `'…'`, `“…”`, `‘…’`, a string left open at the end of its line) and,
   like `jsonrepair`, reads an unquoted `http://…` value as a URL rather than a comment
   (`jsonrepair` `lib/esm/regular/jsonrepair.js:705`).
   - **D, diff** ([`engine-diff.ts`](engine-diff.ts)): overwrite each comment with spaces, run
     `jsonrepair`, align input and output with a Myers character diff, write each comment back over
     its surviving placeholder (or insert it at the mapped position).
   - **T, tagged whitespace** ([`engine-tagged.ts`](engine-tagged.ts)): replace each comment with a
     whitespace tag encoding its index (tabs and spaces; the tab frame is longer than any tab run in
     the file), run `jsonrepair`, which copies whitespace between tokens through and escapes tabs
     inside strings, then replace each tag with its comment. No diff.
   - Both move the closing brackets `jsonrepair` appends to a truncated file after the comments at
     its end; otherwise those comments would land outside the root.
3. **Measurement** ([`run.ts`](run.ts), [`measure.ts`](measure.ts)): comments and anchors in the
   output are found with `jsonc-parser`'s scanner and tree, not with the engines' own scanner.
4. **Supporting evidence, not counted:** [`fuzz.ts`](fuzz.ts) generates random valid commented
   documents (seeded), breaks each in one to three ways, and measures expected anchors on the valid
   document before breaking it, so nothing there is hand-written. [`bench.ts`](bench.ts) times both
   engines up to 50 MB.

## Results (20 fixtures)

Generated by `run.ts`; per-fixture table, every output and any miss in
[`results.md`](results.md), raw data in [`results.json`](results.json).

| Option | Kept, reading B (anchors) | Kept, reading A (texts) | Comments kept |
|---|---|---|---|
| Plain `jsonrepair` 3.15.0 | 0 of 20 | 0 of 20 | 0 of 42 |
| **D**, diff | **20 of 20** | **20 of 20** | 42 of 42 |
| **T**, tagged whitespace | **20 of 20** | **20 of 20** | 42 of 42 |

Every output parses in its format and has the same data as plain `jsonrepair`. Neither engine
needed a fallback on the fixtures (column "Unplaced" is 0 everywhere).

Harness note: the first run of `run.ts` reported 11 of 20 because `jsonc-parser`'s `getNodeValue`
builds objects with a null prototype, which `isDeepStrictEqual` treats as different from
`JSON.parse`'s objects. The comparison now goes through JSON; no engine code changed for it. The
fixture result committed in `818d6ee` (engine D's first version) was already 20 of 20.

## Supporting evidence: generated cases (not part of the count)

5000 cases per run; a case passes under reading B. The generator writes JSONC-style documents
(double quotes) and breaks them with: missing comma, truncation, unquoted key, unquoted string,
single quotes, Python constant, ellipsis, Markdown fence, JSONP.

| Run | Engine T | Engine D |
|---|---|---|
| Seed 20261008, 1 break (development) | 5000 | 5000 |
| Seed 7, 2 breaks (development) | 5000 | 5000 |
| **Seed 31337, 1 break (held out)** | **5000** | **5000** |
| **Seed 31337, 2 breaks (held out)** | **5000** | **5000** |
| **Seed 31337, 3 breaks (held out)** | **5000** | **5000** |

Development seeds found three engine faults, fixed before the held-out runs: closing brackets added
ahead of a comment at the end of a truncated file (engine D's first version passed 93.6% on seed
20261008), an unquoted `http://…` value read as a comment, and engine T's first count of the
brackets `jsonrepair` added. Seed 31337 was first run after the last engine change. The held-out
reports are committed as `fuzz-<engine>-31337-x<breaks>.md`.

**Known failure classes** (found by hand, not in either set): a comment between the parts of a
concatenated string (`"a" + // c` then `"b"`) is lost by T (reported as lost) and put inside the
string by D (data differs). `jsonrepair` cannot repair a string left open with a comment on its line
(`"Hello, // note`), so there is nothing to keep. Both failures are caught by the same three checks
the spike measures (parse, data, every comment present), which is what §Consequences proposes the
product run.

## Timings

From [`bench.md`](bench.md) (one run each; Intel Xeon 2.80 GHz, 4 cores, Node 22.22.0):

| File | jsonrepair | T | D |
|---|---|---|---|
| 1 MB, `"` | 109 ms | 377 ms | 318 ms |
| 10 MB, `"` | 1197 ms | 4879 ms | 41512 ms |
| 50 MB, `"` | 6819 ms | 49702 ms | skipped |
| 0.01 MB, `'` (every string changes) | 2 ms | 4 ms | 507 ms |
| 10 MB, `'` | 901 ms | 3877 ms | skipped |

D's diff grows with the number of characters `jsonrepair` changes, so it stalls on files where
every string changes quote. T stays within about 4× of plain `jsonrepair` up to 10 MB; at 50 MB
(1.1 M comments) its tags double the text and it takes about 7×. Spec 008's large-file thresholds
(UNK-014) apply to repair too.

## Decision under the evidence rule

**UNK-018: keep comments.** 20 of 20 under reading B and 20 of 20 under reading A, both ≥ 18, so the
two readings agree and the delegation rule covers the decision (Decider = delegated; a Reviewer that
did not write this signs it; authority UNK-005).

The rule's fallback ("repair asks before removing comments that are not attached to removed keys")
does not apply as the general behavior.

## Consequences

- **For 003 T8 (repair action):** move engine T and `scan.ts` into `packages/core` with unit tests,
  using these fixtures and the generator as test inputs. Engine D, `run.ts`, `fuzz.ts` and
  `bench.ts` stay spike code. `jsonrepair` (ISC, already a dependency of `vanilla-jsoneditor`)
  becomes a direct runtime dependency of `core`; it passes `check:licenses` (AGENTS.md rule 4).
- **Proposal, not decided by UNK-018's rule:** the product runs the three checks on every repair
  (output parses in the file's format, its data equals plain `jsonrepair`'s, every input comment is
  present). When one fails, which the spike shows for the known failure classes above, it falls
  back to the rule's "otherwise" path: ask before removing the comments it could not keep. This
  needs the 003 T8 Reviewer, or the owner, to agree; it is not settled by this spike.
- **JSON5 (UNK-028, owner):** `jsonrepair` 3.15.0 outputs strict JSON. On a JSON5 file it turns hex
  `0x1F` into the string `"0x1F"` and `Infinity`/`NaN` into strings, reads a line continuation
  `"a\<LF>b"` as `"a\nb"`, throws on `+1`, rewrites `'…'` as `"…"`, quotes unquoted keys and drops
  trailing commas. The fixtures' data condition compares with `jsonrepair` itself, so it does not
  catch this (fixture 18 keeps its comments while its hex values become strings). It affects
  repair on JSON5 files with or without comments, so it is outside UNK-018 and goes to the owner.

## Reproduce

```sh
pnpm install
pnpm --filter @chr-json-editor/spike-repair-comments spike   # writes results.md and results.json
cd spikes/repair-comments
node --experimental-strip-types fuzz.ts 31337 2 T             # writes fuzz-T-31337-x2.md
node --experimental-strip-types --max-old-space-size=8000 bench.ts   # writes bench.md (minutes)
```

Measured on Node v22.22.0, Linux, 2026-10-08. Versions are pinned in [`package.json`](package.json)
and `pnpm-lock.yaml`. Nothing here ships: the spike package is `private` with only
`devDependencies`.
