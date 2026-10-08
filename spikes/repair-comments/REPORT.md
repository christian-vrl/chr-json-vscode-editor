# Spike 002 T11 — Repairing broken JSONC/JSON5 while keeping comments (UNK-018)

**Result:** _pending — this section is filled in after the run._

## How this report reads UNK-018's rule (written before the run)

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
