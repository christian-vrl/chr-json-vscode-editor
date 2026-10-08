# Core benchmark: parse and one edit per format (002 T8)

> Spec 002 criterion 7. Written by `bench/core/report.mjs` from one benchmark run; do not edit
> by hand. Re-run it (the `bench` workflow) whenever `packages/core/src/formats` changes speed.

## Run

- Where: GitHub Actions, [run 37854765987](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37854765987); commit `04dc5b73b20d78b9923c218b7838b6a6a603f7ba`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 7763 64-Core Processor, 8 GiB RAM.
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
`applyPatch(text, [op])` on the middle record `m`, returning the whole new text:

- **replace:** `{ op: "replace", path: "/m/name", value: "edited" }`, one string.
- **add:** `{ op: "add", path: "/m/extra", value: { added: true } }`, a new key.
- **remove:** `{ op: "remove", path: "/m" }`, a whole record with its comments.
- **move:** `{ op: "move", from: "/m", path: "/-" }`, the record to the end; `move` re-parses
  between its remove and its add (002 T6).

### json

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **220** (210, 220, 248) | **129** (145, 129, 117) | **146** (146, 127, 155) | **138** (138, 143, 117) | **270** (279, 259, 270) |
| 10 MiB | **2,108** (2,608, 2,108, 1,703) | **1,245** (1,246, 1,245, 1,202) | **884** (1,240, 884, 869) | **1,210** (947, 1,210, 1,258) | **2,084** (2,230, 1,977, 2,084) |
| 50 MiB | **7,427** (7,863, 7,427, 7,122) | **5,238** (5,238, 5,242, 5,225) | **5,608** (5,211, 5,920, 5,608) | **5,242** (5,988, 5,242, 5,206) | **12,971** (15,710, 12,628, 12,971) |

### jsonc

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **251** (251, 254, 250) | **140** (157, 136, 140) | **145** (135, 145, 151) | **145** (140, 150, 145) | **292** (295, 292, 278) |
| 10 MiB | **1,664** (1,534, 1,664, 1,665) | **1,174** (1,174, 1,162, 1,180) | **810** (1,170, 806, 810) | **1,121** (785, 1,173, 1,121) | **1,938** (1,938, 1,968, 1,804) |
| 50 MiB | **6,947** (6,947, 7,038, 6,650) | **4,843** (4,843, 4,536, 4,897) | **5,543** (4,956, 5,543, 5,617) | **4,817** (5,718, 4,457, 4,817) | **12,694** (12,820, 12,694, 12,113) |

### json5

| Size | parse | replace | add | remove | move |
|---|---|---|---|---|---|
| 1 MiB | **150** (150, 135, 152) | **144** (144, 133, 150) | **140** (149, 140, 139) | **150** (153, 150, 142) | **325** (294, 325, 328) |
| 10 MiB | **1,515** (1,519, 1,515, 1,468) | **1,410** (1,407, 1,439, 1,410) | **1,458** (1,478, 1,458, 1,433) | **1,448** (1,461, 1,433, 1,448) | **2,695** (2,635, 2,695, 2,725) |
| 50 MiB | **6,270** (6,270, 6,070, 6,432) | **6,247** (6,247, 6,075, 6,435) | **6,228** (6,201, 6,228, 6,536) | **6,293** (6,190, 6,298, 6,293) | **15,645** (14,816, 16,061, 15,645) |

## Memory

**Retained heap** is what one parse result (data, tree, tokens, style, diagnostics) keeps alive
after a full collection, so what a host holding the parsed document pays. **Max RSS** is the
peak resident memory of the measuring process over the whole cell (source text, every parse and
edit), in MiB. The heap ceiling is raised because with the GitHub runner's default (about 2 GiB)
the first run of this benchmark ran out of heap in the json 50 MiB cell
([run 37852960823](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37852960823)).

| Size | json retained heap | json max RSS | jsonc retained heap | jsonc max RSS | json5 retained heap | json5 max RSS |
|---|---|---|---|---|---|---|
| 1 MiB | 22 | 190 | 22 | 182 | 15 | 180 |
| 10 MiB | 222 | 1,136 | 218 | 1,029 | 152 | 1,059 |
| 50 MiB | 1,102 | 5,054 | 1,082 | 4,698 | 750 | 4,683 |

## Against UNK-014's edit budget (< 500 ms)

applyPatch is only the host part of an edit: the UI, the message and `workspace.applyEdit` come on
top (`bench/vscode-open.md`). So a cell over 500 ms here misses the budget whatever else happens;
one under it is necessary, not sufficient.

| Size | json | jsonc | json5 |
|---|---|---|---|
| 1 MiB | within, slowest op 270 | within, slowest op 292 | within, slowest op 325 |
| 10 MiB | over, slowest op 2,084 | over, slowest op 1,938 | over, slowest op 2,695 |
| 50 MiB | over, slowest op 12,971 | over, slowest op 12,694 | over, slowest op 15,645 |

Medians relative to parse, over all sizes and formats (edit ÷ parse): replace 0.6–1.0×, add 0.4–1.0×, remove 0.6–1.0×, move 1.0–2.5×.

Every `applyPatch` call parses the whole text again (tree and tokens) before it edits, and `move`
parses twice, so edit time grows with file size like parse time does.

To reproduce: `pnpm --filter @chr-json-editor/core build`, then
`pnpm --filter @chr-json-editor/bench bench:core` (or the `bench` workflow, `.github/workflows/bench.yml`).
