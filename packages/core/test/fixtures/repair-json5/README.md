# JSON5 repair fixtures (003 T8, UNK-028)

Each folder holds a broken `input.json5` with JSON5-only values that jsonrepair 3.15.0 alone would
change or reject (spike 002 T11 REPORT.md §Consequences), and `expected.json5`, the repair's output,
reviewed by hand: the break is fixed, every comment stays at its place, and every JSON5-only value is
written exactly as in the input (a string with a JSON5-only escape keeps its own quotes), so the data
is unchanged. Other keys and strings get JSON quoting and trailing commas go, as UNK-028 accepts.

| Case | Values | Break |
|---|---|---|
| `escapes` | JSON5-only escapes | missing comma |
| `hex-keys` | identifier keys named like values, hex values | missing commas |
| `infinity-nan` | Infinity and NaN, signed and not | missing commas |
| `line-continuation` | line continuations (LF and CRLF) | missing comma |
| `plus-sign` | a plus sign | missing comma after +1 |
