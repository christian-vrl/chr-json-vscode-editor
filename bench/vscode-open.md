# Large-file benchmark: open, first render, one edit (003 T11)

> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.
> Measured end to end in the custom editor's webview (after 003 T5).

## Run

- Where: GitHub Actions, [run 37872733611](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37872733611); commit `da7d83f39acddedab90687c051ab19a093f71b25`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 9V45 96-Core Processor, 8 GiB RAM.
- VS Code 1.141.0 (stable at run time, `--disable-gpu`, under xvfb), the e2e .vsix (release build plus test hooks).
- 3 runs per size; each cell is **median** (run 1, run 2, run 3), in milliseconds (the edit on the webview's clock, the rest on the extension host's). The editor is closed between runs, so every run opens the file again in the same VS Code window; the edit runs right after each open.
- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.
- 100 MiB is not measured: VS Code does not hand files above 50 MB to extensions ("Files above 50MB cannot be synchronized with extensions"), so the custom editor never opens it ([run 37844893412](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412)).

## Results

| Size | Webview ready | First render | One edit | value shown | host applies it | Second edit |
|---|---|---|---|---|---|---|
| 1 MiB (1,048,576 B) | **542** (1,681, 542, 491) | **752** (2,167, 688, 752) | **144** (144, 121, 264) | **19** (15, 19, 39) | **95** (99, 95, 91) | **241** (383, 241, 84) |
| 5 MiB (5,242,880 B) | **948** (1,540, 902, 948) | **1,119** (1,742, 1,040, 1,119) | **253** (577, 220, 253) | **23** (63, 14, 23) | **94** (223, 94, 93) | **160** (143, 348, 160) |
| 10 MiB (10,485,760 B) | **1,614** (1,727, 1,564, 1,614) | **1,960** (2,094, 1,960, 1,918) | **569** (585, 569, 438) | **23** (19, 23, 25) | **136** (134, 136, 152) | **556** (556, 426, 690) |
| 50 MiB (52,428,800 B) | **7,917** (7,917, 9,128, 7,644) | **9,349** (9,349, 10,153, 8,672) | **2,248** (2,248, 2,284, 1,839) | **54** (41, 93, 54) | **883** (883, 1,115, 784) | **5,156** (3,486, 6,588, 5,156) |

## Against UNK-014's rule (open < 3 s, one edit < 500 ms)

"Open" is the first render: the time until the user sees the document in the tree.

Both edits count: the slower median of the first and the second edit must be under 500 ms.

| Size | First render | One edit | Second edit | Verdict |
|---|---|---|---|---|
| 1 MiB | 752 | 144 | 241 | pass |
| 5 MiB | 1,119 | 253 | 160 | pass |
| 10 MiB | 1,960 | 569 | 556 | miss: edit too slow |
| 50 MiB | 9,349 | 2,248 | 5,156 | miss: open too slow, edit too slow |

Largest size that passes: **5 MiB**.

## The same in a second VS Code launch

Timed again after the first launch closed, on the same runner: how far one launch's medians
can move. The verdict above uses the first launch.

| Size | Webview ready | First render | One edit | value shown | Second edit |
|---|---|---|---|---|---|
| 1 MiB | **352** (1,305, 352, 329) | **450** (1,626, 436, 450) | **77** (90, 74, 77) | **16** (14, 16, 19) | **131** (237, 129, 131) |

## What is measured

- **Webview ready:** from `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview script
  sends `ready`. Covers VS Code reading the file, syncing it to the extension host, creating the
  webview and loading webview.js.
- **First render:** from the same start until the tree shows the root's "<n> items" tag. On top of
  ready: the host sends the text (`init`), the webview parses it (the library's `parser` prop,
  criterion 10: `JSON.parse` for strict JSON, else `core`) and the library renders the tree.
- **One edit:** a `replace` of the first record's `name`, made down the webview's edit path (test
  hook `patch`: the library applies it, as a tree edit does, and the same `edit` message goes to
  the host, without the click and typing). Timed on the webview's clock, where the edit starts,
  until the host's answer is in and the editor is free again: nothing in flight, the document
  shown. The answer carries the whole new text; the webview keeps the data it already shows.
  **Value shown:** until the tree shows the new value, which it does before the host answers.
  **Host applies it:** on the host's clock, from sending the patch until the document changed:
  the message, `core` applyPatch and the WorkspaceEdit. After the change the host parses the new
  text once in the background (format badge, schema validation, the next edit), which can delay
  an edit made right after.
- **Second edit:** the same edit with another value, made as soon as the first settled: the host
  now edits the text its first edit produced, not the one it parsed on open. Run 1 of each size
  is the first open of that file in this VS Code launch (cold); runs 2 and 3 open it again.

To reproduce: `pnpm build && CHR_TEST_HOOKS=1 pnpm package`, then `xvfb-run -a pnpm --filter
@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).
