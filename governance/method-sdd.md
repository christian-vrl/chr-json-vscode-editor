# SDD Method — Portable Core (project-agnostic)

> The `constitution.md` is what you must **never violate**; this file is **how you work**.
> Spec-Driven Development vocabulary, no external toolkit dependency — only the step names and
> the gate structure are borrowed (ADR-004, origin project's decision ledger). No project facts
> here — a project's concrete phase content lives in that project's spec.

## 1. Versioning: local git first, promote later

"Into git" does **not** mean publish — `git init` with no remote is 100% offline.
- **Day 1:** local `git init`, import the corpus, freeze a baseline commit. Every commit is a
  dated, verifiable snapshot (hash): "this conclusion was drawn against commit `abc123`".
- All analysis happens locally, in branches; every analysis artifact is **committed**, so every
  conclusion is reproducible from the repository.
- Promotion/sharing to a remote: only **after** verification (golden master).

## 2. The SDD flow

| Step | Artifact | Answers |
|---|---|---|
| **Constitution** | `governance/constitution.md` | Which rules do I never violate? |
| **Specify** | `spec/<NNN-feature>/spec.md` | The *what* and *why* (no implementation) |
| **Plan** | `spec/<NNN-feature>/plan.md` | *How*: approach, constraints, order, risks |
| **Tasks** | `spec/<NNN-feature>/tasks.md` | Verifiable steps, each with evidence/gate |
| **Implement** | code/docs | One task at a time |
| **Verify** | gate | Prove (not presume) it does what the spec says |

The spec is the source of truth; plan and tasks derive from it; implementation is verified
**against** it. Desired behavior changed? Change the **spec** first, not the code.

## 3. Phase structure (structure is universal; content is per-project)

Every phase is described by five fields:

| Field | Defines |
|---|---|
| **Goal** | The phase's observable result. |
| **Required method** | How to produce it reproducibly (committed script, not manual judgment). |
| **Evidence to produce** | The artifact proving the goal (catalog, matrix, test, ADR…). |
| **Escalation triggers** | Conditions that force stop-and-ask (constitution §4). |
| **Gate (Definition of Done)** | The binary condition to advance. **Never crossed while open UNKNOWNS affect the phase's result** (constitution §2). |

## 4. Definition of Done (global gates)

An increment is "done" only when **all** hold:
1. Zero open UNKNOWNS affecting the increment's result.
2. Verification passed under the human-confirmed (not presumed) equivalence criterion.
3. Every parameter/decision traceable to evidence (constitution §2).
4. Every analysis reproducible from the commit (versions and seeds pinned).
5. No subjective classification ("drift", "equivalent", "common") without human confirmation.
6. Rollback tested for any change affecting production/data.

## 5. Standard artifacts (always committed)

- `governance/constitution.md` + `governance/method-sdd.md` — this core.
- `spec/<NNN-feature>/` — `spec.md`, `plan.md`, `tasks.md` per feature.
- `UNKNOWNS.md` — the unknowns ledger, always current.
- `DECISIONS.md` — ADRs: each decision with its evidence and human-confirmation ID.
- `tests/` — golden masters and characterization tests (when there is behavior to preserve).

> A project's concrete phase content, stack, clustering, adapters, etc. live in that project's
> spec/plan — **not** in this core (ADR-002, origin project's decision ledger).
