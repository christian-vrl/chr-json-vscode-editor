---
name: sdd-task-runner
description: >
  Execute one task from spec/<NNN>-<slug>/tasks.md end to end (claim, implement, prove the gate,
  open the PR, get it reviewed) without needing the owner. Use when a thread is assigned or picks a task.
version: 0.2.0
tags: [sdd, workflow, implementation]
---

# SKILL — sdd-task-runner

## Goal
Act as the Implementer for exactly one task and deliver a PR whose gate is proven by CI and signed
by an independent Reviewer.

## When to activate
- "Do task 002-T3", "pick the next task", a thread started for a task, or a Reviewer FAIL to fix.

## Sources of truth (priority order)
1. `governance/constitution.md`, `governance/method-sdd.md`
2. `AGENTS.md` (rules, standard scripts, autonomy envelope)
3. `spec/INDEX.md`, then the task's `spec.md`, `plan.md`, `tasks.md`
4. `spec/DECISIONS.md`, `spec/UNKNOWNS.md`
Never present speculation as fact (constitution D6).

## Procedure
1. **Pick** per `spec/INDEX.md` §How an agent picks work.
2. **Claim** by pushing branch `t/<NNN>-<Tn>` from `main` before any other work. If the push shows
   the branch already exists, pick another task.
3. **Check unknowns.** If an open UNKNOWN affects this task's result, stop: add evidence to its row,
   set it `escalated`, push that change on your branch, and tell the Coordinator. Do not pick an
   option (D5). For a *delegated* row, follow the rule in `spec/UNKNOWNS.md`'s header.
4. **Write the gate test first** when the gate is a test; commit it failing.
5. **Implement** the smallest change that makes the gate pass. Anything outside the task becomes a
   new UNKNOWN or a note under "Off the critical path".
6. **Prove.** Run `pnpm lint && pnpm build && pnpm test:unit` and the task's gate command; paste the
   gate output into the PR description.
7. **Record.** New ADRs as `proposed`, new UNKNOWNS, numbered per `AGENTS.md` rule 9. Flip the task's
   own marker to `[x]` in this PR (it shows on `main` only once merged).
8. **Open the PR** titled `<NNN>-<Tn>: <task title>` with sections Task · Gate · Evidence · Unknowns raised.
   Ask the Coordinator for a Reviewer thread.
9. **On FAIL:** fix with new commits (never rewrite shared history), re-run step 6, ask for re-review.
   After the 3rd FAIL on the same task, stop and ask the Coordinator to escalate to the owner.
10. **On PASS:** enable auto-merge if UNK-006 resolved to ★; otherwise tell the Coordinator the PR is ready for the owner.

## Expected output
One PR with green CI, gate evidence in the description, the task marked `[x]` in the diff, and no unrelated changes.

## Anti-hallucination
- Never invent library APIs: read the installed package's `.d.ts` and cite path + line.
- Never edit an `expected.*` golden file or an acceptance criterion to make a test pass.
- Under uncertainty: state it and escalate (constitution §4); never fill by assumption.

## Limits
Does not review its own PR, merge outside UNK-006's policy, touch `governance/`, publish, or change
repo settings (`AGENTS.md` rule 7).
