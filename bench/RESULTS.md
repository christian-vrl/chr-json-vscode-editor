# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 37867109909](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37867109909); commit `e8040abc6745c57db8446c7ee354778d012ecbf6`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 9V45 96-Core Processor, 8 GiB RAM.
- Node v22.23.3, `@chr-json-editor/core` built from that commit, called directly (no editor, no webview, no message passing). Each format and size runs in its own process (`--expose-gc`, heap collected before every timed call; `--max-old-space-size=6144`, Node's default heap limit on this machine: 2.0 GiB, see Memory).
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

`parse` is `getAdapter(format).parse(text)` (data, tree, style, diagnostics). Each edit is one
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

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **113** (114, 100, 113) | **88** (88, 72, 93) | **91** (92, 78, 91) | **72** (82, 72, 67) | **116** (119, 116, 109) |
| 10 MiB | **1,110** (1,292, 1,110, 972) | **491** (575, 491, 466) | **527** (498, 527, 530) | **521** (482, 530, 521) | **817** (817, 933, 815) |
| 50 MiB | **6,394** (6,693, 6,073, 6,394) | **4,903** (4,872, 5,439, 4,903) | **4,804** (4,828, 4,804, 4,642) | **4,785** (4,900, 4,785, 4,676) | **8,387** (8,387, 8,420, 8,192) |

After the text was parsed (json):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (3, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **34** (34, 39, 34) |
| 10 MiB | **0** (0, 0, 0) | **2** (2, 2, 1) | **0** (0, 0, 0) | **337** (344, 337, 325) |
| 50 MiB | **0** (0, 0, 0) | **6** (6, 6, 5) | **0** (0, 0, 0) | **1,908** (2,125, 1,881, 1,908) |

### jsonc

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **125** (125, 152, 101) | **78** (83, 78, 77) | **84** (90, 84, 73) | **72** (72, 72, 73) | **106** (105, 106, 111) |
| 10 MiB | **719** (812, 717, 719) | **443** (467, 432, 443) | **455** (458, 455, 437) | **431** (431, 431, 478) | **631** (631, 620, 632) |
| 50 MiB | **6,194** (6,299, 6,194, 5,650) | **4,850** (4,850, 4,367, 4,984) | **4,350** (4,410, 4,350, 4,140) | **4,786** (4,829, 4,786, 4,732) | **6,988** (6,988, 7,076, 6,804) |

After the text was parsed (jsonc):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **1** (1, 1, 1) | **0** (0, 0, 0) | **32** (35, 32, 30) |
| 10 MiB | **0** (0, 5, 0) | **1** (1, 4, 1) | **0** (0, 0, 0) | **233** (233, 235, 215) |
| 50 MiB | **0** (0, 0, 0) | **12** (12, 6, 12) | **0** (0, 0, 0) | **812** (795, 812, 820) |

### json5

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **94** (107, 88, 94) | **87** (87, 85, 90) | **98** (100, 98, 98) | **92** (97, 91, 92) | **127** (127, 131, 127) |
| 10 MiB | **704** (825, 704, 696) | **669** (666, 683, 669) | **710** (712, 688, 710) | **713** (713, 736, 677) | **906** (851, 946, 906) |
| 50 MiB | **6,225** (6,960, 6,149, 6,225) | **6,470** (6,924, 6,209, 6,470) | **7,013** (6,286, 7,084, 7,013) | **6,898** (7,133, 6,898, 6,367) | **9,593** (9,075, 9,593, 9,629) |

After the text was parsed (json5):

| Size | replace | add | remove | move |
|---|---|---|---|---|
| 1 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **38** (38, 36, 39) |
| 10 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **168** (167, 168, 175) |
| 50 MiB | **0** (0, 0, 0) | **0** (0, 0, 0) | **0** (0, 0, 0) | **864** (883, 862, 864) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json max RSS | jsonc retained heap | jsonc max RSS | json5 retained heap | json5 max RSS |
|---|---|---|---|---|---|---|
| 1 MiB | 31 | 248 | 30 | 236 | 26 | 227 |
| 10 MiB | 406 | 1,796 | 396 | 1,681 | 347 | 1,685 |
| 50 MiB | 2,061 | 5,893 | 2,007 | 5,889 | 1,760 | 5,471 |

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient. The cells use the host's case, a text already parsed.

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB | within, slowest op 34 | within, slowest op 32 | within, slowest op 38 |
| 10 MiB | within, slowest op 337 | within, slowest op 233 | within, slowest op 168 |
| 50 MiB | over, slowest op 1,908 | over, slowest op 812 | over, slowest op 864 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.4–1.0×, add 0.5–1.1×, remove 0.5–1.1×, move 0.7–1.5×.

An edit on a text core has not parsed parses it once (tree and tokens) before it edits, so its
time grows with file size like parse time does. On a parsed text, replace, add and remove only
compute the change and write the new text; move also shifts the tree and tokens after the
removed record.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
