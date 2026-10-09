# Repair-with-comments spike fixtures (002 T11, UNK-018)

The 20 broken commented fixtures UNK-018's evidence rule counts: 10 JSONC (`01`–`10`) and 10 JSON5
(`11`–`20`). Each folder holds `input.<format>` (the broken file, byte for byte) and `case.json`.
They were committed before the repair engine existed, so neither the inputs nor the expected
anchors were fitted to it.

**How they were chosen.** Each fixture breaks the file in one way taken from the list of repairs in
the `jsonrepair` 3.15.0 README (the repair library `vanilla-jsoneditor` already uses), named in
`jsonrepairClass`; two (`14`, `17`) are repairs `jsonrepair` performs that its README does not list.
Every fixture has at least one comment on the line of the break or next to it, two hold `//` inside
a string (`04`, `07`), one holds JSON5-only literals (`18`, hex), and every input is repairable by
plain `jsonrepair` (otherwise there is nothing to keep comments through). The spike only measures
comments, so a fixture's break does not need to be realistic beyond being one `jsonrepair` handles.

**`case.json`** — `format`, `breakage` (prose), `jsonrepairClass`, and `comments`: every comment in
the input, in order, with its exact text and where a person would expect it after the repair,
written by hand:

| Field | Meaning |
|---|---|
| `text` | the comment's exact bytes, `//` or `/* */` included |
| `container` | JSON Pointer of the innermost array or object whose brackets enclose the comment; `null` when it is outside the root value |
| `outside` | only with `container: null`: `before` or `after` the root value |
| `before` | how many of that container's members end before the comment |
| `trailing` | the comment starts on the line where member `before - 1` ends (UNK-008's same-line trailing comment); `false` when `before` is 0 or with `inside` |
| `inside` | JSON Pointer of the member whose span (key start to value end) holds the comment, e.g. between key and value |

A member's span runs from its key (objects) or value (arrays) to the end of its value.
