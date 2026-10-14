# PLAN 019 — Settings

> Derives from spec `019`. Constraints from `governance/constitution.md`
> (D3 observable behavior, D4 reversibility).

## Approach
One settings reader in the extension host (`packages/vscode-extension/src/settings.ts`, wired in
`src/activate.ts`): `readSettings(document)` reads `getConfiguration('chrJsonEditor', { uri,
languageId })` and `editor.tabSize`/`editor.insertSpaces` for I1, checks each value against the
manifest's type and range, and falls back to the default (A6). A pure part (`settingsFrom(inspect)`)
takes VS Code's `inspect` results so criterion 2 is a unit test without VS Code. Everything that
reads a fixed value today asks the reader instead:
- `largeFile.ts` and `smartFormatPlan.ts` take the threshold as an argument instead of
  `LARGE_FILE_THRESHOLD` (the constant stays as the default); every later threshold gate (016 T4,
  017 T4, 018 T4) uses the same function.
- Smart Format passes `maxLineLength` into core's `smartFormat` as an option; core's default stays
  120, so the golden corpus without `options.json` is unchanged.
- Core's style detection says when it found no indentation, and `applyPatch`, `stringify` and the
  convert and CSV writers take a fallback indent option (default 2 spaces); the host passes I1's.
- The editor provider puts M1's mode in `init.mode` and the page settings in `init.settings`.

The page (`packages/app-shell`) gets a typed `EditorSettings` (`thresholdBytes`,
`defaultQueryLanguage`, `flattenColumns`, `escapeControlCharacters`, `escapeUnicodeCharacters`)
instead of any JSON object, and one new host → page message, `settings`, which the host posts to
every open tab when `onDidChangeConfiguration` affects it (A2). `App.svelte` passes the display
props to the library (`updateProps` on change), starts Transform with Q1's language, and gives
`size-gate.ts` the threshold instead of its constant. The dev host takes settings in its options, so
`pnpm test:web` drives criterion 9 without VS Code. Validation (V1) is host-only: a disabled tab
posts an empty `validation` message, the message the page already understands.

## Constraints / invariants
- No overwrite without snapshot/backup (D4): no setting changes a document or file by itself;
  every default reproduces today's behavior except I1 under UNK-088 ★.
- Offline (AGENTS rule 3): nothing is fetched; no new dependency.
- `core` and app-shell stay free of Node APIs (spec 013); core never reads settings, it takes options.
- Webview messages: the PR that adds `settings` and the typed `init.settings` (T2) bumps the protocol
  version by one with its changelog row; the number is the next free one on `main` when it merges.
- Shared files: `package.json` (`contributes.configuration`, the `openSettings` command and its
  `menus.commandPalette` entry), `src/activate.ts` and `test/web/coverage.json` are touched by T1 only;
  T6 adds web e2e cases but no coverage row. Serialize T1 with other PRs touching those files.

## Steps (each with a gate)
| Step | Goal | Evidence to produce | Gate |
|---|---|---|---|
| A | Manifest, reader, Open Settings, default mode, validation switch | `settings.ts`, unit table, e2e | criteria 1–3, 8, 11 |
| B | Page settings and the live message | protocol bump, `App.svelte`, `tests/web` cases | criteria 7, 9 |
| C | Threshold setting through every gate | e2e on 008's fixtures | criterion 4 |
| D | Smart Format line length | golden cases with `options.json`, e2e | criterion 5 |
| E | Indentation of new text | core option, unit cases, e2e | criterion 6 |
| F | Web | web e2e cases | criterion 10 |

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| R1 Core's parse cache keys on the text, but the fallback indent is a setting | the fallback is an argument of the write (`applyPatch`, `stringify`), not of `parse`; the cached style says "none found" and the writer fills it in |
| R2 The library's escape props also change text mode | the page never passes JSON data to text mode (content is always `{ text }`), and criterion 9 checks text mode's text; if a library update changes that, pass the props only outside text mode |
| R3 Language-specific values for `.json5` files: VS Code has no built-in `json5` language, so the language id may be `plaintext` or another extension's | read with the document's real `languageId`; the README says `[json5]` needs a JSON5 language extension; criterion 3 uses `[json]` |
| R4 A threshold change between open and a command makes one tab's mode and a gate disagree | the mode is per tab (008 criterion 1); gates read the value when they run, as the spec says (A3, A4) |
| R5 A busy `settings` message during a Transform dialog | Q1 changes only a tab whose dialog language has not been picked; display props are applied by `updateProps`, which keeps the library's state |
| R6 Threshold gates added by later specs miss the setting | the threshold function in `largeFile.ts` is the only source; a unit test greps `packages/*/src` for `5 * 1024 * 1024` outside the defaults and `COMPARE_LIMIT_BYTES` |

## Definition of Done
1. Criteria 1–12 green in CI.
2. UNK-087 and UNK-088 resolved.
3. README (spec 005) has a settings section: the keys, the `[json]` override example and the
   `workbench.editorAssociations` example for opening `.json` files in CHR JSON Editor by default.
