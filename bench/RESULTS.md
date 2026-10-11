# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7 and spec 008 criterion 7. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: local machine (not the CI runner); commit `97f6548c18eb9908aea13b6542173e236878555d`.
- Machine: Linux x64 (`6.18.44-fc-v80`), 4 × Intel(R) Xeon(R) Processor @ 2.80GHz, 16 GiB RAM.
- Node v22.22.0, `@chr-json-editor/core` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (`--expose-gc`, heap collected before every timed call; `--max-old-space-size=6144`, Node's default heap limit on this machine: 8.0 GiB, see Memory).
- 3 runs per cell after a warm-up on a 256 KiB document; each cell is **median** (run 1, run 2, run 3), in milliseconds.

## Files

Each size is exactly N × 2^20 bytes (MiB, as in `bench/vscode-open.md`), ASCII only, one array of
records padded inside the last record. Built in memory by `bench/core/run.mjs`:

- **json:** `bench/generate.mjs`, the file 003 T11 opens in VS Code (pretty-printed, 2 spaces).
- **jsonc:** the same records with a `//` comment before each, a `/* */` comment inside each, a
  trailing comma in each nested object and after the last record.
- **json5:** as jsonc, plus unquoted keys, single-quoted strings, a hex field and trailing commas
  after every last member.

Records per file:

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB (1,048,576 B) | 4,372 | 4,323 | 4,305 |
| 10 MiB (10,485,760 B) | 43,361 | 42,702 | 42,530 |
| 50 MiB (52,428,800 B) | 215,488 | 211,612 | 210,767 |

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

### json

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **139** (154, 117, 139) | **8** (9, 8, 8) | **94** (96, 94, 86) | **93** (90, 99, 93) | **88** (88, 87, 88) | **160** (160, 149, 178) |
| 10 MiB | **1,359** (1,580, 1,291, 1,359) | **66** (64, 66, 69) | **960** (960, 1,014, 951) | **951** (951, 1,036, 910) | **857** (848, 877, 857) | **1,513** (1,551, 1,513, 1,497) |
| 50 MiB | **12,816** (23,156, 12,191, 12,816) | **407** (396, 407, 419) | **10,232** (11,318, 9,218, 10,232) | **10,224** (9,398, 10,704, 10,224) | **9,494** (9,896, 9,494, 9,472) | **15,840** (15,840, 16,072, 14,927) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **51** (51, 64, 50) |
| 10 MiB | **0** (0, 0, 0) | **6** (6, 6, 6) | **0** (0, 0, 0) | **564** (552, 564, 605) |
| 50 MiB | **0** (0, 0, 0) | **37** (46, 37, 37) | **0** (0, 0, 0) | **4,784** (4,784, 4,482, 5,458) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **121** (137, 121, 117) | **42** (42, 42, 25) | **136** (96, 136, 136) | **89** (89, 87, 93) | **93** (123, 93, 93) | **132** (173, 132, 130) |
| 10 MiB | **1,249** (1,450, 1,158, 1,249) | **370** (399, 370, 332) | **863** (863, 795, 887) | **833** (878, 787, 833) | **814** (843, 814, 803) | **1,192** (1,192, 1,214, 1,102) |
| 50 MiB | **10,989** (17,734, 10,577, 10,989) | **1,949** (1,916, 1,949, 1,975) | **8,527** (9,956, 8,527, 8,507) | **9,368** (9,368, 10,059, 9,222) | **10,446** (10,968, 10,236, 10,446) | **13,821** (14,636, 12,796, 13,821) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **46** (54, 43, 46) |
| 10 MiB | **0** (0, 0, 0) | **6** (6, 6, 6) | **0** (0, 0, 0) | **295** (295, 290, 306) |
| 50 MiB | **0** (0, 0, 0) | **37** (38, 37, 36) | **0** (0, 0, 0) | **3,327** (2,843, 3,348, 3,327) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **106** (107, 106, 67) | **33** (33, 23, 36) | **70** (73, 67, 70) | **71** (62, 71, 72) | **65** (65, 60, 66) | **150** (151, 150, 134) |
| 10 MiB | **775** (863, 753, 775) | **308** (308, 287, 308) | **804** (804, 841, 755) | **780** (780, 873, 750) | **721** (721, 746, 713) | **1,093** (1,128, 1,093, 1,079) |
| 50 MiB | **10,091** (15,452, 10,091, 7,883) | **1,605** (1,544, 1,700, 1,605) | **9,906** (10,416, 8,738, 9,906) | **10,156** (10,015, 10,156, 10,277) | **9,135** (9,524, 7,733, 9,135) | **13,449** (14,226, 11,661, 13,449) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **61** (65, 61, 56) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **368** (368, 341, 372) |
| 50 MiB | **0** (0, 0, 0) | **0** (0, 1, 0) | **0** (0, 0, 0) | **2,291** (2,193, 2,665, 2,291) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays; **parseData heap** is
the same for `parseData`'s result (the data alone), measured first. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json parseData heap | json max RSS | jsonc retained heap | jsonc parseData heap | jsonc max RSS | json5 retained heap | json5 parseData heap | json5 max RSS |
|---|---|---|---|---|---|---|---|---|---|
| 1 MiB | 31 | 1 | 249 | 30 | 2 | 244 | 26 | 2 | 227 |
| 10 MiB | 406 | 12 | 1,821 | 396 | 20 | 1,703 | 342 | 21 | 1,656 |
| 50 MiB | 2,061 | 58 | 5,841 | 2,007 | 100 | 5,735 | 1,732 | 105 | 5,603 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 6% (8 ÷ 139 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 5% (66 ÷ 1,359 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 3% (407 ÷ 12,816 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 35% (42 ÷ 121 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 30% (370 ÷ 1,249 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 18% (1,949 ÷ 10,989 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 31% (33 ÷ 106 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 40% (308 ÷ 775 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 16% (1,605 ÷ 10,091 ms) | 6% (105 ÷ 1,732 MiB) | pass |

Verdict: criterion 7 holds in this run.

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB | within, slowest op 51 | within, slowest op 46 | within, slowest op 61 |
| 10 MiB | over, slowest op 564 | within, slowest op 295 | within, slowest op 368 |
| 50 MiB | over, slowest op 4,784 | over, slowest op 3,327 | over, slowest op 2,291 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.7–1.1×, add 0.7–1.0×, remove 0.6–1.0×, move 1.0–1.4×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
