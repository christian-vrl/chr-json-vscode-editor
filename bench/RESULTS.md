# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7, spec 008 criterion 7 and spec 010 criterion 11. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 38180270577](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38180270577); commit `18f9284ea1f7a7fe63ee81dbad4d48fcf76c5a33`.
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
| 1 MiB | **129** (173, 121, 129) | **6** (6, 6, 6) | **90** (92, 90, 85) | **89** (89, 92, 89) | **90** (92, 90, 88) | **117** (117, 125, 116) |
| 10 MiB | **1,184** (1,485, 1,169, 1,184) | **57** (57, 57, 59) | **777** (777, 807, 769) | **791** (791, 822, 789) | **789** (789, 822, 780) | **1,281** (1,281, 1,288, 1,253) |
| 50 MiB | **8,982** (10,202, 8,263, 8,982) | **346** (346, 345, 348) | **7,188** (6,171, 7,188, 7,242) | **5,939** (5,939, 7,125, 5,931) | **6,151** (6,779, 6,151, 6,087) | **10,006** (10,006, 9,769, 10,805) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **31** (33, 26, 31) |
| 10 MiB | **0** (0, 0, 0) | **3** (3, 3, 3) | **0** (0, 0, 0) | **466** (466, 458, 473) |
| 50 MiB | **0** (0, 0, 0) | **17** (17, 18, 16) | **0** (0, 0, 0) | **2,654** (2,676, 2,653, 2,654) |

### jsonc

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **119** (130, 119, 115) | **47** (47, 52, 44) | **87** (88, 87, 86) | **90** (90, 92, 88) | **90** (90, 90, 88) | **125** (125, 124, 131) |
| 10 MiB | **996** (1,125, 996, 993) | **318** (318, 318, 312) | **689** (689, 689, 691) | **704** (704, 700, 709) | **705** (715, 705, 705) | **1,099** (1,117, 1,097, 1,099) |
| 50 MiB | **7,975** (8,809, 7,975, 7,120) | **1,565** (1,538, 1,574, 1,565) | **6,534** (6,569, 6,534, 6,504) | **5,542** (6,612, 5,542, 5,516) | **6,555** (6,623, 6,555, 5,365) | **9,310** (10,420, 9,310, 9,199) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **41** (44, 38, 41) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 3, 2) | **0** (0, 0, 0) | **373** (373, 372, 373) |
| 50 MiB | **0** (0, 0, 0) | **18** (18, 18, 18) | **0** (0, 0, 0) | **2,307** (2,307, 2,303, 2,310) |

### json5

| Size | parse | parseData | replace | add | remove | move |
|---|---|---|---|---|---|---|
| 1 MiB | **68** (90, 68, 64) | **38** (35, 38, 40) | **70** (69, 71, 70) | **68** (70, 64, 68) | **69** (76, 66, 69) | **113** (109, 113, 113) |
| 10 MiB | **620** (768, 604, 620) | **260** (260, 262, 249) | **604** (595, 610, 604) | **596** (599, 584, 596) | **593** (593, 572, 606) | **871** (865, 871, 872) |
| 50 MiB | **5,559** (5,559, 6,133, 5,077) | **1,303** (1,307, 1,264, 1,303) | **5,892** (6,260, 5,892, 4,758) | **4,881** (4,881, 5,881, 4,827) | **4,887** (4,887, 4,731, 6,176) | **9,159** (7,984, 9,298, 9,159) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **45** (45, 41, 46) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **274** (282, 274, 272) |
| 50 MiB | **1** (1, 0, 3) | **1** (4, 1, 0) | **0** (0, 0, 0) | **1,464** (1,505, 1,463, 1,464) |

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
| 1 MiB | 31 | 1 | 253 | 30 | 2 | 242 | 26 | 2 | 230 |
| 10 MiB | 406 | 12 | 1,847 | 396 | 20 | 1,778 | 342 | 21 | 1,681 |
| 50 MiB | 2,061 | 58 | 5,683 | 2,007 | 100 | 5,839 | 1,731 | 105 | 5,704 |

## Spec 008 criterion 7: parseData against parse

For jsonc and json5 at 10 and 50 MiB, `parseData`'s median time and its retained heap must each be
at most 50% of `parse`'s, in this run. json takes `JSON.parse`, so it is shown but not judged.

| Format | Size | time parseData ÷ parse | heap parseData ÷ parse | Result |
|---|---|---|---|---|
| json | 1 MiB | 5% (6 ÷ 129 ms) | 4% (1 ÷ 31 MiB) | not judged |
| json | 10 MiB | 5% (57 ÷ 1,184 ms) | 3% (12 ÷ 406 MiB) | not judged |
| json | 50 MiB | 4% (346 ÷ 8,982 ms) | 3% (58 ÷ 2,061 MiB) | not judged |
| jsonc | 1 MiB | 40% (47 ÷ 119 ms) | 7% (2 ÷ 30 MiB) | not judged |
| jsonc | 10 MiB | 32% (318 ÷ 996 ms) | 5% (20 ÷ 396 MiB) | pass |
| jsonc | 50 MiB | 20% (1,565 ÷ 7,975 ms) | 5% (100 ÷ 2,007 MiB) | pass |
| json5 | 1 MiB | 57% (38 ÷ 68 ms) | 8% (2 ÷ 26 MiB) | not judged |
| json5 | 10 MiB | 42% (260 ÷ 620 ms) | 6% (21 ÷ 342 MiB) | pass |
| json5 | 50 MiB | 23% (1,303 ÷ 5,559 ms) | 6% (105 ÷ 1,731 MiB) | pass |

Verdict: criterion 7 holds in this run.

## Spec 010 criterion 11: smart format

`smartFormat(text, format)` (FracturedJson 5.1.0 with spec 010 §Layout, 010 T2) beside
Format's `getAdapter(format).prettyPrint(text)`, on the same files at 1 MiB and at the 5 MiB
threshold above which smart format is off (criterion 10). Each call parses the text it formats.
HYPOTHESIS: the 5 MiB median is under 5,000 ms on the CI runner.

| Format | Size | smartFormat | prettyPrint | smartFormat ÷ prettyPrint | output size |
|---|---|---|---|---|---|
| json | 1 MiB | **331** (366, 331, 305) | **108** (107, 114, 108) | 3.1× | 0.92 MiB |
| json | 5 MiB | **1,315** (1,388, 1,315, 1,241) | **557** (561, 556, 557) | 2.4× | 4.61 MiB |
| jsonc | 1 MiB | **369** (374, 369, 330) | **1,341** (1,353, 1,341, 1,340) | 0.3× | 1.06 MiB |
| jsonc | 5 MiB | **1,354** (1,435, 1,354, 1,275) | **19,812** (19,812, 19,709, 19,893) | 0.1× | 5.29 MiB |
| json5 | 1 MiB | **448** (480, 448, 371) | **1,303** (1,297, 1,316, 1,303) | 0.3× | 1.06 MiB |
| json5 | 5 MiB | **1,711** (1,878, 1,711, 1,584) | **19,743** (19,817, 19,609, 19,743) | 0.1× | 5.31 MiB |

Verdict: the hypothesis holds in this run (every 5 MiB median is under 5,000 ms).

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB | within, slowest op 31 | within, slowest op 41 | within, slowest op 45 |
| 10 MiB | within, slowest op 466 | within, slowest op 373 | within, slowest op 274 |
| 50 MiB | over, slowest op 2,654 | over, slowest op 2,307 | over, slowest op 1,464 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.7–1.1×, add 0.7–1.0×, remove 0.7–1.0×, move 0.9–1.7×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
