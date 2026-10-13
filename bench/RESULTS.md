# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7 and spec 012 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38247455427](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38247455427); commit `f7af4cceb3618105760faff5144bdbb080a93add`.
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
| 1 MiB | **115** (115, 115, 113) | **6** (6, 6, 6) | **100** (100, 108, 82) | **84** (81, 87, 84) | **83** (83, 89, 82) | **123** (121, 124, 123) |
| 10 MiB | **1,086** (1,231, 969, 1,086) | **67** (63, 72, 67) | **699** (704, 699, 688) | **700** (700, 737, 693) | **706** (706, 759, 694) | **1,091** (1,091, 1,117, 1,088) |
| 50 MiB | **8,269** (8,909, 8,269, 7,324) | **350** (349, 364, 350) | **6,555** (6,574, 6,555, 6,407) | **6,370** (6,370, 6,643, 5,551) | **6,569** (6,198, 6,579, 6,569) | **8,236** (7,680, 8,992, 8,236) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **39** (41, 36, 39) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 3, 2) | **0** (0, 0, 0) | **384** (381, 384, 389) |
| 50 MiB | **0** (0, 0, 0) | **17** (17, 18, 17) | **0** (0, 0, 0) | **1,177** (1,177, 1,140, 1,200) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **117** (122, 111, 117) | **50** (50, 24, 52) | **87** (87, 83, 87) | **87** (88, 86, 87) | **84** (84, 85, 84) | **119** (120, 117, 119) |
| 10 MiB | **925** (1,070, 925, 924) | **310** (314, 310, 310) | **628** (641, 627, 628) | **644** (644, 676, 642) | **644** (647, 644, 641) | **810** (811, 808, 810) |
| 50 MiB | **7,595** (7,595, 6,634, 7,846) | **1,542** (1,532, 1,542, 1,574) | **5,398** (5,440, 5,145, 5,398) | **5,161** (5,161, 5,089, 5,514) | **5,186** (5,186, 6,318, 5,054) | **9,005** (9,101, 8,971, 9,005) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **37** (39, 34, 37) |
| 10 MiB | **0** (0, 0, 0) | **2** (1, 3, 2) | **0** (0, 0, 0) | **185** (187, 174, 185) |
| 50 MiB | **0** (0, 0, 0) | **17** (17, 16, 18) | **0** (0, 0, 0) | **1,386** (1,376, 1,386, 1,431) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **63** (77, 63, 62) | **29** (28, 29, 33) | **57** (57, 57, 60) | **65** (57, 65, 65) | **63** (64, 63, 63) | **104** (103, 104, 105) |
| 10 MiB | **526** (674, 526, 517) | **192** (190, 192, 200) | **521** (516, 521, 529) | **547** (547, 540, 550) | **542** (533, 542, 550) | **752** (746, 752, 762) |
| 50 MiB | **5,860** (6,549, 4,848, 5,860) | **969** (969, 959, 977) | **4,825** (4,558, 4,825, 5,794) | **4,850** (4,850, 4,636, 5,142) | **4,963** (5,862, 4,784, 4,963) | **8,579** (8,579, 9,085, 8,033) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **40** (42, 37, 40) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **217** (218, 200, 217) |
| 50 MiB | **0** (0, 0, 0) | **0** (1, 0, 0) | **0** (0, 0, 0) | **1,541** (1,541, 1,518, 1,546) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **106** (114, 106, 102) | **10** (10, 10, 10) | **12** (13, 12, 12) | **12** (12, 12, 11) | **11** (12, 11, 11) | **12** (12, 12, 12) |
| 10 MiB | **676** (842, 676, 676) | **114** (115, 114, 113) | **120** (132, 118, 120) | **124** (132, 122, 124) | **124** (132, 121, 124) | **122** (132, 122, 120) |
| 50 MiB | **3,828** (4,633, 3,828, 3,828) | **581** (580, 583, 581) | **655** (771, 655, 652) | **655** (760, 655, 655) | **650** (769, 647, 650) | **663** (779, 663, 661) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 2, 3) | **2** (2, 2, 3) | **2** (2, 2, 2) | **3** (3, 3, 3) |
| 10 MiB | **21** (18, 21, 21) | **21** (19, 21, 21) | **18** (19, 18, 18) | **24** (26, 23, 24) |
| 50 MiB | **108** (107, 109, 108) | **110** (152, 107, 110) | **110** (110, 110, 109) | **136** (136, 138, 136) |

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
| 1 MiB | 31 | 1 | 247 | 30 | 2 | 245 | 26 | 2 | 229 | 21 | 2 | 156 |
| 10 MiB | 406 | 12 | 1,790 | 396 | 20 | 1,688 | 342 | 21 | 1,639 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 6,012 | 2,007 | 100 | 5,810 | 1,731 | 105 | 5,707 | 1,353 | 90 | 3,120 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 115 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (67 ÷ 1,086 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (350 ÷ 8,269 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 43% (50 ÷ 117 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 34% (310 ÷ 925 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,542 ÷ 7,595 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 45% (29 ÷ 63 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 37% (192 ÷ 526 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 17% (969 ÷ 5,860 ms) | 6% (105 ÷ 1,731 MiB) | pass |
| jsonl | 1 MiB | 9% (10 ÷ 106 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 17% (114 ÷ 676 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 15% (581 ÷ 3,828 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **10** (10, 10, 10) | **8** (8, 8, 8) | 1.22 | not judged |
| 10 MiB | **114** (115, 114, 113) | **96** (97, 95, 96) | 1.19 | not judged |
| 50 MiB | **581** (580, 583, 581) | **508** (508, 507, 517) | 1.14 | pass |

Verdict: criterion 12 holds in this run.

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 39 | within, slowest op 37 | within, slowest op 40 | within, slowest op 3 |
| 10 MiB | within, slowest op 384 | within, slowest op 185 | within, slowest op 217 | within, slowest op 24 |
| 50 MiB | over, slowest op 1,177 | over, slowest op 1,386 | over, slowest op 1,541 | within, slowest op 136 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.0×, remove 0.1–1.0×, move 0.1–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
