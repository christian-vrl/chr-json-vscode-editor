# JSON5 CST spike cases (002 T4, UNK-012)

The 20 cases UNK-012's evidence rule counts. Each folder holds `input.json5`, `patch.json` (one
RFC 6902 op), `expected.json5` (hand-written bytes) and `case.json` (`op` and the JSON5 feature the
case exercises). An option passes a case when its output is byte-equal to `expected.json5`.

These cases were committed before any option was run. They are spike evidence only: the contract
for the shipped adapter is the golden corpus under `tests/golden/` (002 T1), not this folder.

Expected bytes follow spec 002 R1–R10 and UNK-008. Where those rules leave a detail open, these
cases use the following spike-local reading (002 T1 may settle it differently):

- **Majority quote (R4, R8):** count every quoted string token in the file, keys and values; a tie
  goes to `"`.
- **Unquoted new key (R4):** the key matches `^[A-Za-z_$][A-Za-z0-9_$]*$` and more than half of the
  existing keys in that object are unquoted.
- **Comma before a trailing comment (R6):** when a new member follows a last member that has no
  comma, the comma goes right after that member's value, before any same-line comment.

Every case only touches the JSON5 features named in its `case.json`, so a failure points at the
parser's handling of that feature (acceptance, offsets or key decoding).
