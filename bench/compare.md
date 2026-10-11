# Compare benchmark: structural compare at 1, 5, 10 and 50 MiB (007 T5)

> Evidence for UNK-037 (spec 007 criterion 10). Written by `bench/compare-report.mjs` from one
> benchmark run; do not edit by hand. Re-run it (the `bench` workflow, job `compare`) whenever
> the compare panel, `compare` or `diff` changes speed.

## Run

- Where: GitHub Actions, [run 38164950423](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/38164950423); commit `6d78fb0b4fb82412d62df03ff9d257ff2764b556`.
- Machine: Linux x64 (`ubuntu24`), 4 × AMD EPYC 9V45 96-Core Processor, 16 GiB RAM.
- VS Code 1.141.0 (linux x64) with the e2e .vsix; Node v22.23.3 for the core part.
- 3 runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds. Run 1 of each size is the first compare of those files in the VS Code launch.

## Files

Left: `node bench/generate.mjs`, the file 003 T11 opens (one pretty-printed array of 7-field
records, exactly N × 2^20 bytes, ASCII only). Right: `node bench/generate.mjs --changed`, the
same document with every 100th record’s name in capitals (about 1% of the records changed, same
length), so `compare` reports one `changed` difference per changed record. Neither file is open in
an editor when the compare starts.

| Size | Bytes per side | Records | Differences |
|---|---|---|---|
| 1 MiB | 1,048,576 | 4,372 | 44 |
| 5 MiB | 5,242,880 | 21,726 | 217 |
| 10 MiB | 10,485,760 | 43,361 | 434 |
| 50 MiB | 52,428,800 | 215,488 | 2,155 |

## Compare panel in VS Code (UNK-037’s rule)

- **Open:** from running "Compare Selected" on the two files until the compare page shows both
  trees with the differences marked (each side’s root carries `chr-diff-inside`) and its counter
  reads "<n> differences": the host reads and parses both documents and runs `compare`, the page
  receives both texts, parses them and renders. **Posted** is the share until the host has posted
  the compare to the page.
- **Refresh:** one live refresh (criterion 7), from a `WorkspaceEdit` on the right document (one
  more record’s name in capitals) until the page’s counter shows one difference more. It includes
  the panel’s 100 ms pause after a change.
- **Rule (UNK-037):** open median < 3,000 ms and refresh median < 1,000 ms; the limit is the largest size that meets both.

| Size | Open | Posted | Refresh | Meets the rule |
|---|---|---|---|---|
| 1 MiB | **416** (677, 339, 416) | **238** (489, 202, 238) | **253** (277, 253, 237) | yes |
| 5 MiB | **614** (1,011, 614, 605) | **439** (760, 437, 439) | **733** (836, 733, 667) | yes |
| 10 MiB | **1,257** (1,598, 1,257, 1,188) | **959** (1,263, 959, 882) | **1,323** (1,323, 1,344, 1,214) | no |
| 50 MiB | **12,460** (14,268, 12,460, 12,216) | **8,338** (8,977, 8,338, 8,029) | **14,034** (15,419, 14,034, 12,121) | no |

**Largest size that meets the rule on this run: 5 MiB.**

## Core alone (the host’s share, in Node)

- **Parse both:** both sides parsed as the panel parses a strict JSON side (`JSON.parse`).
- **`compare`:** `compare(left, right)` alone (plan 007 R3).
- **Copy:** one difference (the middle one) copied from right into left as "Copy to left" does:
  `copyDifference` and the json adapter’s `applyPatch` on a left text core has not parsed yet (the
  panel parses strict JSON with `JSON.parse`, so core holds no parse of it). **`copyDifference`**
  is its share alone (plan 007 R6).
- Each size in its own Node process (`--expose-gc`, `--max-old-space-size=6144`), after a warm-up on a 256 KiB pair.

| Size | Parse both | `compare` | Copy | `copyDifference` | Peak RSS (GiB) |
|---|---|---|---|---|---|
| 1 MiB | **5** (6, 5, 5) | **32** (39, 32, 32) | **67** (82, 67, 64) | **< 1** (< 1, < 1, < 1) | 0.2 |
| 5 MiB | **28** (28, 26, 30) | **209** (209, 200, 209) | **262** (394, 262, 217) | **< 1** (< 1, < 1, < 1) | 0.6 |
| 10 MiB | **62** (64, 61, 62) | **403** (379, 418, 403) | **556** (558, 556, 419) | **< 1** (< 1, < 1, < 1) | 1.1 |
| 50 MiB | **348** (348, 352, 334) | **2,524** (2,414, 2,524, 2,611) | **4,311** (3,905, 5,100, 4,311) | **< 1** (< 1, < 1, < 1) | 5.2 |
