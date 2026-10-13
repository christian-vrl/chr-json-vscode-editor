# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7, spec 010 criterion 11 and spec 012 criterion 12. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38396805859](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38396805859); commit `cadc2c739572bc2198898df385e5f91766656ec6`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V74 80-Core Processor, 16 GiB RAM.
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
| 1 MiB | **121** (128, 121, 120) | **6** (6, 6, 6) | **91** (91, 90, 91) | **89** (89, 90, 88) | **99** (99, 100, 96) | **140** (125, 144, 140) |
| 10 MiB | **1,096** (1,361, 1,056, 1,096) | **63** (62, 64, 63) | **767** (767, 790, 757) | **784** (776, 836, 784) | **803** (812, 803, 778) | **1,287** (1,287, 1,306, 1,276) |
| 50 MiB | **9,301** (10,037, 9,301, 9,252) | **389** (392, 387, 389) | **7,537** (7,537, 7,525, 7,558) | **7,262** (7,262, 7,177, 7,547) | **7,484** (7,109, 7,484, 7,494) | **11,181** (11,181, 11,742, 10,828) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 2) | **0** (0, 0, 0) | **35** (35, 33, 35) |
| 10 MiB | **0** (0, 0, 0) | **5** (3, 6, 5) | **0** (0, 0, 0) | **481** (492, 477, 481) |
| 50 MiB | **0** (0, 0, 0) | **8** (8, 8, 8) | **0** (0, 0, 0) | **2,981** (2,981, 2,952, 2,983) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **115** (127, 115, 111) | **47** (48, 47, 47) | **89** (91, 82, 89) | **87** (92, 86, 87) | **87** (90, 87, 86) | **124** (127, 124, 124) |
| 10 MiB | **970** (1,114, 970, 962) | **300** (300, 296, 307) | **681** (674, 681, 681) | **684** (684, 685, 678) | **683** (695, 683, 680) | **1,109** (1,127, 1,109, 1,099) |
| 50 MiB | **8,398** (9,215, 7,464, 8,398) | **1,557** (1,570, 1,547, 1,557) | **6,655** (5,716, 7,056, 6,655) | **6,946** (7,038, 6,919, 6,946) | **7,055** (7,116, 6,984, 7,055) | **10,088** (10,106, 10,088, 9,208) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **44** (45, 44, 43) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 3) | **0** (0, 0, 0) | **405** (424, 401, 405) |
| 50 MiB | **0** (0, 0, 0) | **8** (8, 7, 8) | **0** (0, 0, 0) | **1,909** (1,909, 1,909, 1,891) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **66** (90, 66, 60) | **26** (26, 32, 26) | **67** (67, 66, 71) | **72** (75, 72, 67) | **68** (64, 101, 68) | **114** (114, 114, 111) |
| 10 MiB | **587** (765, 587, 587) | **184** (182, 184, 186) | **586** (586, 587, 582) | **609** (609, 605, 615) | **626** (630, 625, 626) | **915** (899, 915, 922) |
| 50 MiB | **5,906** (5,906, 4,878, 6,244) | **921** (921, 926, 921) | **6,114** (6,114, 5,536, 6,615) | **6,712** (6,712, 6,733, 6,623) | **5,036** (5,013, 5,036, 6,761) | **9,607** (9,445, 9,607, 9,866) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **48** (48, 43, 48) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **294** (308, 292, 294) |
| 50 MiB | **0** (0, 1, 0) | **1** (1, 1, 0) | **0** (0, 0, 0) | **1,601** (1,601, 1,609, 1,595) |

### jsonl

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **114** (118, 114, 112) | **10** (10, 10, 10) | **13** (14, 13, 13) | **13** (13, 13, 13) | **12** (13, 12, 12) | **13** (13, 12, 13) |
| 10 MiB | **758** (920, 758, 758) | **122** (127, 121, 122) | **134** (144, 132, 134) | **136** (142, 136, 135) | **141** (145, 141, 140) | **136** (149, 136, 136) |
| 50 MiB | **4,388** (5,299, 4,384, 4,388) | **621** (615, 621, 632) | **668** (791, 668, 664) | **670** (769, 670, 663) | **667** (781, 667, 666) | **676** (797, 676, 675) |

After the text was parsed (jsonl):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **3** (3, 3, 3) | **3** (3, 3, 3) | **2** (2, 2, 3) | **3** (3, 3, 3) |
| 10 MiB | **21** (19, 22, 21) | **22** (18, 22, 22) | **21** (19, 21, 21) | **27** (23, 28, 27) |
| 50 MiB | **108** (107, 108, 110) | **109** (107, 109, 109) | **108** (110, 103, 108) | **137** (174, 137, 136) |

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
| 1 MiB | 31 | 1 | 242 | 30 | 2 | 243 | 26 | 2 | 223 | 21 | 2 | 157 |
| 10 MiB | 406 | 12 | 1,881 | 396 | 20 | 1,778 | 342 | 21 | 1,670 | 269 | 19 | 710 |
| 50 MiB | 2,061 | 58 | 5,916 | 2,007 | 100 | 5,812 | 1,732 | 105 | 5,779 | 1,353 | 90 | 3,125 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 121 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 6% (63 ÷ 1,096 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (389 ÷ 9,301 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 41% (47 ÷ 115 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 31% (300 ÷ 970 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 19% (1,557 ÷ 8,398 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 39% (26 ÷ 66 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 31% (184 ÷ 587 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 16% (921 ÷ 5,906 ms) | 6% (105 ÷ 1,732 MiB) | pass |
| jsonl | 1 MiB | 9% (10 ÷ 114 ms) | 9% (2 ÷ 21 MiB) | not judged |
| jsonl | 10 MiB | 16% (122 ÷ 758 ms) | 7% (19 ÷ 269 MiB) | not judged |
| jsonl | 50 MiB | 14% (621 ÷ 4,388 ms) | 7% (90 ÷ 1,353 MiB) | not judged |

Verdict: criterion 7 holds in this run.

## Spec 012 criterion 12: JSON Lines against one JSON array

`parseData('jsonl')` at 50 MiB must take a median time at most 1.25 times that of
`parseData('json')` on the same records written as one JSON array (`[`, the lines joined by `,`,
`]`), in this run.

| Size | parseData('jsonl') | parseData('json') on the array | jsonl ÷ array | Result |
|---|---|---|---|---|
| 1 MiB | **10** (10, 10, 10) | **9** (9, 9, 9) | 1.13 | not judged |
| 10 MiB | **122** (127, 121, 122) | **107** (107, 113, 106) | 1.14 | not judged |
| 50 MiB | **621** (615, 621, 632) | **574** (574, 570, 584) | 1.08 | pass |

Verdict: criterion 12 holds in this run.

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **331** (331, 338, 303) | **109** (107, 109, 122) | 3.0× | 0.92 MiB |
| json | 5 MiB | **1,326** (1,402, 1,326, 1,207) | **538** (523, 551, 538) | 2.5× | 4.61 MiB |
| jsonc | 1 MiB | **373** (395, 373, 332) | **113** (113, 116, 112) | 3.3× | 1.06 MiB |
| jsonc | 5 MiB | **1,380** (1,452, 1,380, 1,254) | **490** (490, 490, 495) | 2.8× | 5.29 MiB |
| json5 | 1 MiB | **465** (493, 465, 387) | **95** (92, 96, 95) | 4.9× | 1.06 MiB |
| json5 | 5 MiB | **1,741** (1,913, 1,741, 1,626) | **485** (486, 480, 485) | 3.6× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 | jsonl |
|---|---|---|---|---|
| 1 MiB | within, slowest op 35 | within, slowest op 44 | within, slowest op 48 | within, slowest op 3 |
| 10 MiB | within, slowest op 481 | within, slowest op 405 | within, slowest op 294 | within, slowest op 27 |
| 50 MiB | over, slowest op 2,981 | over, slowest op 1,909 | over, slowest op 1,601 | within, slowest op 137 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.1–1.0×, add 0.1–1.1×, remove 0.1–1.1×, move 0.1–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
