# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7 and spec 012 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38171442405](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38171442405); commit `6205123a9c0f9973572523b6f3604f4923f7c0e2`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 7763 64-Core Processor, 16 GiB RAM.
- Node v22.23.3, `@chr-json-editor/core` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (`--expose-gc`, heap collected before every timed call; `--max-old-space-size=6144`, Node's default heap limit on this machine: 4.0 GiB, see Memory).
- 3 runs per cell after a warm-up on a 256 KiB document; each cell is **median** (run 1, run 2, run 3), in milliseconds.

## Files

Each size is exactly N × 2^20 bytes (MiB, as in `bench/vscode-open.md`), ASCII only, one array of
records padded inside the last record. Built in memory by `bench/core/run.mjs`:

- **json:** `bench/generate.mjs`, the file 003 T11 opens in VS Code (pretty-printed, 2 spaces).
- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a
  trailing comma in each nested object and after the last record.
- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas
  after every last member.
- **jsonl:** `bench/generate.mjs` `linesText`, the same records as JSON Lines: one
  `JSON.stringify(record)` per line, each ended by `\n`.

Records per file:

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB (1,048,576 B) | 4,372 | 4,323 | 4,305 | 6,897 |
| 10 MiB (10,485,760 B) | 43,361 | 42,702 | 42,530 | 68,086 |
| 50 MiB (52,428,800 B) | 215,488 | 211,612 | 210,767 | 336,787 |

## Results

`parse` is `getAdapter(format).parse(text)` (data, tree, style, diagnostics); `parseData` is
`parseData(format, text)` (the data alone, nothing cached; 008 T1). Each edit is one
`applyPatch(text, [op])` on the middle record `m`, returning the whole new text, on a text core
has not parsed yet (core keeps the parse of the last text per format, so this is the first edit
of a text nothing else parsed). The second table is the extension host's usual case: the text
was parsed already (format badge, schema validation, the previous edit).

- **replace:** `{ op: "replace", path: "/m/name", value: "edited" }`, one string.
- **add:** `{ op: "add", path: "/m/extra", value: { added: true } }`, a new key.
- **remove:** `{ op: "remove", path: "/m" }`, a whole record with its comments.
- **move:** `{ op: "move", from: "/m", path: "/-" }`, the record to the end; between its remove
  and its add, `move` shifts the tree and tokens it has rather than parsing again (UNK-014).

In jsonl, replace and add edit the one line of record `m` (L7), remove and move are whole-line
edits (L4, L6).

### json

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **120** (135, 116, 120) | **6** (6, 6, 6) | **86** (99, 86, 83) | **86** (86, 91, 84) | **84** (84, 86, 81) | **129** (121, 130, 129) |
| 10 MiB | **1,060** (1,239, 991, 1,060) | **59** (59, 59, 60) | **711** (711, 726, 695) | **714** (712, 740, 714) | **717** (717, 756, 693) | **1,137** (1,137, 1,144, 1,115) |
| 50 MiB | **8,369** (8,369, 8,210, 8,514) | **364** (364, 376, 363) | **6,741** (6,842, 6,741, 5,684) | **5,783** (6,784, 5,783, 5,662) | **6,342** (6,342, 6,697, 5,504) | **9,087** (9,087, 8,272, 9,369) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **43** (43, 41, 46) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 3, 3) | **0** (0, 0, 0) | **387** (385, 387, 402) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **1,189** (1,177, 1,191, 1,189) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **119** (124, 114, 119) | **47** (47, 51, 26) | **87** (91, 87, 87) | **85** (90, 84, 85) | **85** (90, 82, 85) | **125** (113, 125, 125) |
| 10 MiB | **917** (1,063, 901, 917) | **322** (326, 322, 311) | **640** (646, 631, 640) | **653** (653, 653, 663) | **649** (649, 651, 649) | **823** (830, 823, 819) |
| 50 MiB | **7,772** (8,516, 7,772, 7,718) | **1,592** (1,592, 1,630, 1,592) | **5,236** (5,236, 5,189, 6,239) | **6,241** (6,146, 6,241, 6,278) | **6,285** (6,321, 6,285, 5,337) | **8,420** (8,420, 8,317, 8,977) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **39** (39, 37, 40) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 2, 6) | **0** (0, 0, 0) | **188** (191, 185, 188) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **1,437** (1,437, 1,441, 1,435) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **63** (81, 62, 63) | **38** (39, 23, 38) | **64** (64, 64, 60) | **60** (59, 60, 63) | **60** (58, 60, 64) | **110** (104, 112, 110) |
| 10 MiB | **529** (687, 529, 527) | **262** (269, 251, 262) | **550** (550, 550, 514) | **515** (527, 511, 515) | **527** (532, 527, 521) | **723** (743, 717, 723) |
| 50 MiB | **5,819** (5,580, 5,819, 5,914) | **1,353** (1,374, 1,349, 1,353) | **4,993** (5,603, 4,993, 4,614) | **5,522** (5,522, 5,581, 4,970) | **5,085** (5,708, 5,085, 4,759) | **7,701** (8,361, 7,701, 7,377) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **42** (42, 39, 42) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **215** (215, 209, 225) |
| 50 MiB | **1** (0, 2, 1) | **1** (1, 1, 0) | **0** (0, 0, 0) | **1,105** (1,085, 1,187, 1,105) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **111** (129, 111, 108) | **10** (10, 10, 12) | **12** (14, 12, 12) | **13** (13, 13, 12) | **12** (13, 12, 12) | **12** (13, 12, 12) |
| 10 MiB | **715** (883, 715, 715) | **115** (115, 114, 115) | **124** (138, 124, 124) | **130** (139, 128, 130) | **128** (137, 126, 128) | **127** (136, 124, 127) |
| 50 MiB | **4,251** (5,086, 4,251, 4,187) | **594** (588, 601, 594) | **660** (776, 659, 660) | **658** (789, 655, 658) | **664** (777, 656, 664) | **667** (790, 667, 666) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 2, 3) | **3** (2, 3, 3) | **2** (2, 2, 3) | **3** (3, 3, 3) |
| 10 MiB | **22** (19, 22, 22) | **22** (19, 22, 22) | **19** (20, 18, 19) | **26** (23, 26, 27) |
| 50 MiB | **112** (111, 153, 112) | **111** (111, 110, 112) | **110** (109, 110, 110) | **138** (156, 83, 138) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays; **parseData heap** is
the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json parseData heap | json max RSS | jsonc retained heap | jsonc parseData heap | jsonc max RSS | json5 retained heap | json5 parseData heap | json5 max RSS | jsonl retained heap | jsonl parseData heap | jsonl max RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | 31 | 1 | 248 | 28 | 2 | 243 | 26 | 2 | 229 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,795 | 396 | 20 | 1,690 | 342 | 21 | 1,645 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,831 | 2,007 | 100 | 5,799 | 1,732 | 105 | 5,775 | 1,353 | 90 | 3,121 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 120 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (59 ÷ 1,060 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (364 ÷ 8,369 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 39% (47 ÷ 119 ms) | 8% (2 ÷ 28 MiB) | not judged |
| jsonc | 10 MiB | 35% (322 ÷ 917 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,592 ÷ 7,772 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 60% (38 ÷ 63 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 50% (262 ÷ 529 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 23% (1,353 ÷ 5,819 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 9% (10 ÷ 111 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 16% (115 ÷ 715 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 14% (594 ÷ 4,251 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **10** (10, 10, 12) | **8** (8, 8, 8) | 1.25 | not judged |
| 10 MiB | **115** (115, 114, 115) | **98** (98, 98, 98) | 1.17 | not judged |
| 50 MiB | **594** (588, 601, 594) | **523** (517, 526, 523) | 1.14 | pass |

Verdict: criterion 12 holds in this run.

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 43 | within, slowest op 39 | within, slowest op 42 | within, slowest op 3 |
| 10 MiB | within, slowest op 387 | within, slowest op 188 | within, slowest op 215 | within, slowest op 26 |
| 50 MiB | over, slowest op 1,189 | over, slowest op 1,437 | over, slowest op 1,105 | within, slowest op 138 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.8×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
