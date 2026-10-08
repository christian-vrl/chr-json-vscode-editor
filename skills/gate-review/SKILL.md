---
name: gate-review
description: >
  Independently verify a task PR against its spec, gate and the constitution, and post the PASS/FAIL
  comment the gate-review CI check reads. Use for every task PR; never on a PR you contributed to.
version: 0.2.0
tags: [sdd, review, verification]
---

# SKILL — gate-review

## Goal
Act as the Reviewer/Judge (`governance/multi-llm-workflow.md` §Roles): decide from evidence only
whether the PR satisfies its task's gate and the spec criteria it touches.

## When to activate
- The Coordinator starts a Reviewer thread for a PR titled `<NNN>-<Tn>: …`, or asks for a re-review.

## Sources of truth (priority order)
1. The task line and gate in `spec/<NNN>-<slug>/tasks.md`; the spec's acceptance criteria
2. `governance/constitution.md` §1, §5, §6
3. CI logs for the PR head commit
4. `AGENTS.md` rules 1–9
Never present speculation as fact (constitution D6).

## Procedure
1. **Independence:** read the `Claude-Session:` trailers of every commit in the PR. If your own session
   appears, stop and tell the Coordinator. When the platform allows a model choice, the Reviewer runs on
   a different model tier than the Implementer (UNK-007).
2. Check out the PR head; record its SHA. Re-run the gate command and `pnpm lint && pnpm build`; keep the output.
3. Score the rubric. For each item give PASS/FAIL, confidence (high/med/low), severity, and evidence
   (path:line, log excerpt, or test name).
4. Report **every** finding, including low-severity and uncertain ones (`multi-llm-workflow.md`
   §Reviewer prompt); a non-blocking finding becomes a new UNKNOWN or a note, not a FAIL.
5. Post one PR comment whose first line is exactly `Gate review <NNN>-<Tn>: PASS @ <head sha>` or
   `Gate review <NNN>-<Tn>: FAIL @ <head sha>`, then the rubric table and findings. A new push needs a new review.
6. For a *delegated* UNKNOWN or ADR in the PR, a PASS also records the resolution in the form given in
   `spec/UNKNOWNS.md`'s header, linking this comment.

## Rubric
| # | Criterion |
|---|---|
| 1 | The task's gate holds, reproduced by you on the head SHA |
| 2 | Changes stay within the task's scope |
| 3 | No `expected.*` golden file or acceptance criterion changed without a spec change |
| 4 | No new network access, CDN, telemetry or remote `$ref`; any new `offline-allowlist.txt` entry is justified |
| 5 | New runtime deps pass `AGENTS.md` rule 4 |
| 6 | Every claim in the PR cites evidence (D2); no inferred behavior (D1, D6) |
| 7 | New UNKNOWNS recorded; none decided without its decider |
| 8 | Only this task's marker changed in `tasks.md`, and it is `[x]` |

## Expected output
One PR comment in the format of step 5.

## Anti-hallucination
- Never PASS a gate you did not reproduce.
- Under uncertainty: FAIL with low confidence and say what evidence would change it.

## Limits
Does not fix code (hands back to the Implementer), merge, or approve on the owner's behalf.
