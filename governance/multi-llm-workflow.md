# Multi-LLM Workflow — Dev & Review Agents

> **Nature:** portable method (Layer 1). How to use LLMs of different sizes as dev and review
> agents within SDD. Handoffs between agents are the **SDD artifacts** (spec → plan → tasks);
> the **gates** are where the reviewer signs off.

## Principle

Large models reason; small models verify and execute the deterministic. Matching **model tier**
to **work type** cuts cost and latency without losing quality — and using a **different** model
to review reduces correlated blind spots (the reviewer doesn't inherit the author's errors).

## Roles ↔ SDD steps ↔ model tier

| Role | SDD step | Tier | Why |
|---|---|---|---|
| **Architect / Planner** | constitution · spec · plan | **Large / Max** | hard reasoning, trade-offs, ambiguity (D5) — where errors are expensive |
| **Implementer** | tasks → implement | **Medium** (Large for complex tasks) | code against an already-decided spec; more mechanical |
| **Reviewer / Judge** | verify (gate) | **Small+fast** for deterministic checklists, **or** a **different Large** for adversarial bug-hunting | independence from the author; cheap volume vs. depth |

## Model tiers (provider-neutral)

Choose by **tier**, not brand — every serious provider has an equivalent per tier.

| Tier | Profile |
|---|---|
| **Max** | top capability; slowest/most expensive; long-horizon work |
| **Large** | very capable; **default** for reasoning and deep review |
| **Medium** | best speed/intelligence balance; high-volume implementation |
| **Small** | fastest/cheapest; classification, lint, checklist review, judging |

Model IDs and prices change often — check the provider's current model/pricing page when
assigning tiers. Rule of thumb: **Large by default** for architecture decisions and review;
Medium for implementation; Small for high-frequency deterministic checks; Max only for genuinely
hard, long-horizon problems.

## Handoff protocol

```
Architect(Large) ──spec/plan/tasks──▶ Implementer(Medium) ──diff──▶ Reviewer(Small, or different Large)
        ▲                                                                    │
        └────────────── gate rejection: back with evidence ◀─────────────────┘
```

- **The artifact is the contract.** The implementer works against `spec.md`/`tasks.md`, not a
  conversation. The reviewer judges the diff against the spec + `constitution.md`, not taste.
- **The author never signs their own gate.** Whoever implemented does not approve verification —
  that breaks independence and repeats correlated errors. The reviewer is always a distinct
  agent/model. Cross-provider review (one family implements, another reviews) further reduces
  correlated blind spots — worth it at the verification gate.
- **Judge with a rubric (LLM-as-judge):** for repeatable verification, give the Small model an
  explicit, gradeable rubric (constitution §3, falsifiability) and ask for a score per
  criterion. Vague rubrics produce noise.

## Reviewer prompt (coverage, not self-filtering)

Strong models told to "only report critical issues" follow that literally and hide findings —
precision rises, coverage falls. At the finding stage ask for **coverage** and filter downstream:

> "Report **every** finding, including low-severity and uncertain ones. Do not filter by
> importance now — a later step does that. For each finding, give estimated **confidence** and
> **severity**. It is better to raise something later discarded than to silence a bug."

## Wiring it into your IDE

Assign **one tier per role** in your tooling: the Large model on the planning agent
(constitution · spec · plan); Medium on the agent that implements tasks; Small — or a Large from
a **different provider** — on a second agent that reviews the diff against the spec. Cost and
latency then match the work: you don't pay Max tier to rename a variable, nor use Small tier to
design architecture.

## Anti-patterns

- The author approving their own gate.
- The same model + same prompt reviewing its own output (correlated errors).
- Max tier for everything (burns budget) or Small tier for architecture (under-reasoning).
- A reviewer told "critical only" at the finding stage (hides bugs — see prompt above).
