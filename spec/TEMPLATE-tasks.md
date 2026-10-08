# TASKS {{NNN}} — {{TITLE}}

> Derives from the plan. `[ ]` pending · `[~]` awaiting human gate · `[x]` done.
> No gate is crossed with open UNKNOWNS that affect the result.

## Phase A — <name> (risk-free / additive)
- [ ] **T1** <action> — *gate: <verifiable condition>*
- [ ] **T2** <action> — *gate: <…>*

## Phase B — <name> (mutation / requires approval)
- [~] **T3** Back up the artifacts to touch (`cp … _vX.Y.bkp.*`) — *gate: backups exist*
- [~] **T4** <mutation> — *gate: <verification>*
- [~] **T5** Final verification + diff reviewed by the human

## Off the critical path
<open UNKNOWNS that do not block the current increment>
