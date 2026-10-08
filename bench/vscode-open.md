# Large-file benchmark: open, first render, one edit (003 T11)

> Evidence for UNK-014. Written by `bench/report.mjs` from one benchmark run; do not edit by hand.
> Re-run it after 003 T5 (see "What is measured"), and again whenever spec 008 needs new numbers.

## Run

- Where: GitHub Actions, [run 37844893412](https://github.com/christian-vrl/chr-json-vscode-editor/actions/runs/37844893412); commit `ab2b176f375d63560445282ef4d9974f028c268c`.
- Machine: Linux x64 (`ubuntu24`), 2 × AMD EPYC 9V45 96-Core Processor, 8 GiB RAM.
- VS Code 1.141.0 (stable at run time, `--disable-gpu`, under xvfb); Chromium 156.0.8078.4 (Playwright, headless).
- 3 runs per size and measure; each cell is **median** (run 1, run 2, run 3), in milliseconds. The editor is closed between runs, so every run opens the file again in the same VS Code window.
- Files: `node bench/generate.mjs`, one pretty-printed JSON array of 7-field records per size, exactly N × 2^20 bytes (MiB, the unit of VS Code's own file limits), ASCII only.

## Results

| Size | Open in custom editor (VS Code) | First render (Chromium) | Edit, UI part (Chromium) | Edit, host part (VS Code) |
|---|---|---|---|---|
| 1 MiB (1,048,576 B) | **371** (650, 371, 215) | **60** (60, 58, 60) | **8** (8, 19, 7) | **301** (359, 301, 173) |
| 10 MiB (10,485,760 B) | **645** (645, 670, 594) | **98** (100, 94, 98) | **12** (8, 13, 12) | **1,206** (1,533, 1,104, 1,206) |
| 50 MiB (52,428,800 B) | **1,846** (1,577, 2,049, 1,846) | **213** (213, 214, 212) | **10** (10, 13, 10) | **4,142** (4,142, 4,238, 4,134) |
| 100 MiB (104,857,600 B) | fails (see Errors below) | **340** (340, 336, 340) | **10** (9, 13, 10) | not run |

Where the host part of the edit goes (medians, ms):

| Size | `document.getText()` | `core` applyPatch | Find the changed span | `workspace.applyEdit` |
|---|---|---|---|---|
| 1 MiB | 0 | 251 | 30 | 24 |
| 10 MiB | 0 | 1,175 | 41 | 9 |
| 50 MiB | 0 | 3,983 | 105 | 51 |
| 100 MiB | — | — | — | — |

In Chromium the UI handed the patch to the host after (medians, ms): 1 MiB 2, 10 MiB 2, 50 MiB 2, 100 MiB 3; the UI cell above runs on to the first frame that shows the new value.

## Against UNK-014's rule (open < 3 s, one edit < 500 ms)

Open here is VS Code's part only and the edit is UI part + host part, without the message between
them, so each number is a lower bound on what a user will see once 003 T5 joins them. A size that
fails here fails for good; a size that passes here can still fail after 003 T5.

| Size | Open | Edit (UI + host medians) | Verdict on these numbers |
|---|---|---|---|
| 1 MiB | 371 | 309 | pass so far |
| 10 MiB | 645 | 1,218 | miss: edit too slow |
| 50 MiB | 1,846 | 4,152 | miss: edit too slow |
| 100 MiB | fails | — | miss: cannot open, no edit possible |

Largest size that passes so far: **1 MiB**. It is an upper bound for spec 008's threshold until the run after 003 T5.

## What is measured

On the commit above, the custom editor's webview is still the 003 T4 placeholder: it never receives
the document (003 T5 wires that), and under its CSP the editor's styles are blocked (UNK-029). So
no single measure covers "open a file and see it in the editor" yet. Instead:

- **Open in custom editor:** `vscode.openWith(uri, "chrJsonEditor.editor")` until the webview's
  script has reported that it ran (e2e test hook). Covers VS Code reading the file, syncing it to the
  extension host and creating the webview. Not covered: sending the text to the webview.
- **First render:** the app-shell standalone page (`packages/app-shell`, the same vanilla-jsoneditor
  003 T5 mounts) in Chromium. Its DevHostAdapter hands the text to the UI as a host `update`, the
  path a webview takes when the host sends a document; timed until the tree shows the root's
  "<n> items" tag (so the whole text was parsed) and the next frame. Not the VS Code webview, and
  styles do apply on this page. The library parses with `JSON.parse` here; 003 T5 switches it to
  `core` (criterion 10), which may be slower.
- **Edit, UI part:** in that page, double-click the first record's `name`, type, press Enter; timed
  from the Enter keydown to the first frame that shows the new value.
- **Edit, host part:** what the extension host does with that patch in 003 T5's design: read the
  document text, `core` applyPatch (style-preserving `replace` of one string in the middle record),
  reduce the new text to the one changed span, and apply it with `workspace.applyEdit`.

To reproduce: `CHR_TEST_HOOKS=1 pnpm package && pnpm build`, then `xvfb-run -a pnpm --filter
@chr-json-editor/bench bench` (or the `bench` workflow, `.github/workflows/bench.yml`).

## Errors, as recorded

- 100 MiB: timed out after 60000 ms waiting for the webview script to run (openTextDocument: cannot open file:///home/runner/work/chr-json-vscode-editor/chr-json-vscode-editor/bench/.data/100mib.json. Detail: Files above 50MB cannot be synchronized with extensions.)
