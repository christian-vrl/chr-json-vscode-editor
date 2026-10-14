# SPEC 019 — Settings

> **Status:** `draft`
> The spec is the source of truth. Plan and tasks derive from it. Desired behavior changed?
> Change the spec first, not the code.

## Problem / motivation
The extension contributes no settings today: `packages/vscode-extension/package.json` has no
`contributes.configuration`, and the host sends the webview `settings: {}` in every `init`
(`src/editorProvider.ts:378`). Every choice a user might want to change is fixed in code: every tab
opens in Tree mode, the large-file threshold is 5 MiB (spec 008), Smart Format wraps at 120
characters (spec 010 L8), new text is indented by 2 spaces (spec 002 R1), the Transform dialog
starts with JSONQuery (spec 011), and validation always runs when a schema is found (spec 004).
jsoneditoronline.org has a "Configuration modal" with font size, indentation, Smart Format's max
line length, escaping, flattened table columns and the JSON parser (§Current evidence). Several
approved specs leave a setting to this spec: 008 (threshold), 010 L8 and UNK-047 (Smart Format
options), 011 (the query language), 015 (a parser setting) and 018 (keybindings). The feature map
lists settings as P2 backlog item 019 (`spec/INDEX.md`).

## Goal
A user changes how CHR JSON Editor behaves through VS Code's own Settings editor or
`settings.json`, at user, workspace, folder and, where it makes sense, language level, in desktop
VS Code, vscode.dev and github.dev alike; a change applies without reloading the window, and with
no settings changed the extension behaves exactly as it does today (except where UNK-088 says).

## Terms
- **Setting:** a key under `chrJsonEditor.` in `contributes.configuration`, read with VS Code's
  `workspace.getConfiguration`. Its **value** is VS Code's effective value for the document
  (`getConfiguration('chrJsonEditor', { uri, languageId })`): a language-specific folder value wins
  over a folder value, then workspace, then user, then the default (VS Code's order).
- **Threshold, ceiling, size:** as spec 008, except that the threshold is the value of
  `chrJsonEditor.largeFileThreshold` (§Settings) when the check runs, in bytes (MiB × 1,048,576);
  by default 5 MiB = 5,242,880 bytes. Size is the UTF-8 length of the text.
- **Tab-level and run-level:** a tab-level setting is read when a CHR JSON Editor tab opens and,
  where §Applying says so, again when it changes; a run-level setting is read each time a command
  or action runs.
- **Display settings:** settings that change only what tree and table mode show, never the data or
  the document text.

## Settings (the manifest test encodes this table)
All keys are in one configuration section titled "CHR JSON Editor". None has `machine` or
`application` scope, so a workspace or a repository's `.vscode/settings.json` can set any of them.

| Key | Type, range | Default | Scope | What it does |
|---|---|---|---|---|
| `chrJsonEditor.defaultMode` | `"tree"`, `"text"`, `"table"` | `"tree"` | language-overridable | M1 |
| `chrJsonEditor.largeFileThreshold` | integer MiB, 1–50 | `5` | resource | T1 (UNK-087 ★) |
| `chrJsonEditor.smartFormat.maxLineLength` | integer, 20–1000 | `120` | language-overridable | F1 |
| `chrJsonEditor.transform.defaultQueryLanguage` | `"jsonquery"`, `"jmespath"`, `"jsonpath-rfc9535"`, `"jsonpath"`, `"javascript"`, `"lodash"` | `"jsonquery"` | resource | Q1 |
| `chrJsonEditor.validation.enable` | boolean | `true` | resource | V1 |
| `chrJsonEditor.table.flattenColumns` | boolean | `true` | resource | D1 |
| `chrJsonEditor.escapeControlCharacters` | boolean | `false` | resource | D2 |
| `chrJsonEditor.escapeUnicodeCharacters` | boolean | `false` | resource | D2 |

Indentation of new text has no key of ours: it follows VS Code's `editor.tabSize` and
`editor.insertSpaces` (I1, UNK-088 ★).

- **M1 Default mode:** a JSON, JSONC or JSON5 tab opens in the value for the document's language
  (`[json]`, `[jsonc]` and the rest override it as VS Code's language settings do). A large-file tab
  (spec 008) offers no Text mode, so `"text"` opens it in Tree. A JSON Lines tab opens in Table, as
  spec 012 says, whatever the value. A mode switched in a tab stays for that tab only.
- **T1 Threshold** (UNK-087 ★): every rule an approved spec states with spec 008's threshold, or
  with "above 5 MiB" meaning it, uses the value instead: 008's large-file mode (chosen when the tab
  opens and kept for its lifetime, 008 criterion 1), Smart Format's refusal (010 criterion 10), the
  query languages a Transform dialog lists (011 criterion 11, 014 criterion 8), and the threshold
  rules of 009, 012, 015, 016, 017 and 018. The value is in whole MiB from 1 to 50; at 50 no
  document VS Code hands to extensions is above it. Limits measured for one feature stay fixed and
  are not the threshold: validation's 10 MiB pause (UNK-041), compare's 5 MiB per side (UNK-037),
  the YAML limit (UNK-077) and VS Code's 50 MB ceiling.
- **F1 Smart Format line length:** FracturedJson's `MaxTotalLineLength` for "Smart Format" (spec
  010) is the value for the document's language; every other option of 010's §Layout stays fixed.
- **I1 Indentation of new text** (UNK-088 ★): where spec 002 falls back to "2 spaces" because the
  text has no indentation to follow (R1: a file with no line breaks; R15: an empty document), and
  where a command writes a new JSON text (009's "Convert CSV to JSON", 012 J1's JSON Lines →
  JSON, 016's schema file, 017's converted file), the indent unit is VS Code's for the document's
  language (for a new file, the new file's language): a tab when `editor.insertSpaces` is `false`,
  else `editor.tabSize` spaces. A document with indentation keeps following it (002 R1);
  `editor.detectIndentation` does not matter here, since there is nothing to detect. Core's own
  default stays 2 spaces, so the golden corpus is unchanged.
- **Q1 Query language:** a tab's first Transform dialog starts with the value. A language picked in
  a dialog stays picked in that tab (today's behavior). When the value is not listed (JavaScript and
  Lodash above the threshold, UNK-049; RFC 9535 likewise, UNK-065; the engine not loaded), the dialog
  starts with the first language listed, as today.
- **V1 Validation:** `false` turns off spec 004's validation for the document: no Ajv run, no
  markers, no "assumed draft-07" notice and no spec 008 "Schema validation paused" item; `true`
  validates as specs 004 and 008 say. It does not touch VS Code's own JSON validation
  (`json.validate.enable`), which is another extension's setting.
- **D1 Flatten columns:** the library's `flattenColumns` in table mode: `true` shows a nested
  object's members in their own columns (today), `false` one column holding the object.
- **D2 Escaping:** the library's `escapeControlCharacters` and `escapeUnicodeCharacters` in tree and
  table mode: a string's control characters show as `\n`, `\t` and the like, and characters outside
  ASCII as `\uXXXX`. Text mode shows the document text as written whatever the values (D3: the
  bytes are the user's), and the data and the document never change because of them.
- **C1 Open Settings:** a command "CHR JSON Editor: Open Settings" (`chrJsonEditor.openSettings`,
  command palette) opens VS Code's Settings editor filtered to the extension
  (`workbench.action.openSettings` with `@ext:christian-vrl.chr-json-editor`).

## Applying (no reload)
- **A1** The host listens to `workspace.onDidChangeConfiguration` and checks
  `affectsConfiguration('chrJsonEditor', document)` (and `editor` for I1) per open document. No
  setting asks for a reload.
- **A2 Tab-level, live:** D1, D2, Q1 and T1's query-language list reach every open tab when they
  change (one host → page message) and apply within 500 ms, with no data, text or undo change. Q1
  changes only a tab whose dialog language has not been picked yet.
- **A3 Tab-level, at open:** M1 and T1's large-file mode apply to tabs opened after the change; an
  open tab keeps its mode and its large-file state (008 criterion 1).
- **A4 Run-level:** F1, I1 and T1's command gates apply to the next run.
- **A5 Validation:** V1 applies to open tabs at once: turned off, markers and the notice go; turned
  on, the document validates.
- **A6 Bad values:** a value of the wrong type or out of range (a hand-edited `settings.json`) is
  read as the default; the extension never fails to open a tab because of a setting.

## Where settings come from on vscode.dev and github.dev
The web extension (spec 013) reads the same keys through the same API; nothing here needs Node or
the network. User settings there are kept by the browser and by Settings Sync when the user turns
it on; workspace settings come from the opened folder's or repository's `.vscode/settings.json`.
(Inferred from VS Code's docs, which do not say where vscode.dev keeps settings; criterion 10 checks
the workspace route in the web host.) No key is `machine`-scoped, so all apply in the browser.

## Restricted Mode and Workspace Trust
The manifest declares no `capabilities.untrustedWorkspaces`, so VS Code keeps the extension off in a
Restricted Mode workspace (VS Code's default; spec 013 §Where we differ). Whether vscode.dev and
github.dev open workspaces in Restricted Mode is UNK-086, open with the owner until release; this
spec does not change the manifest's trust capability. If UNK-086 later leads to declaring
`untrustedWorkspaces` (`true` or `"limited"`), none of this spec's keys needs to be in
`restrictedConfigurations`: none runs code, reads a file or reaches the network, and a workspace
value can only change what is shown, when large-file mode starts and how new text is indented.
In Restricted Mode VS Code would give listed keys their user value only; that decision, and whether
`json.schemas` (another extension's setting, read by spec 004) needs care there, stays with UNK-086.

## Acceptance criterion (falsifiable)
1. **Manifest (unit):** `contributes.configuration` holds exactly §Settings' keys with their type,
   enum, minimum, maximum, default and scope, each with a `markdownDescription`; the section's
   title is "CHR JSON Editor"; no key has `machine`, `machine-overridable` or `application` scope;
   `capabilities` is unchanged (`virtualWorkspaces: true`, no `untrustedWorkspaces`).
2. **Reading (unit):** the host's settings reader, given VS Code's `inspect` results as a table,
   returns each value, the language value over the plain one, and the default for every wrong type
   and out-of-range value (A6: `"5"`, `0`, `51`, `2.5`, `null`, `"TREE"`, an unknown language id).
3. **Default mode (e2e):** with `chrJsonEditor.defaultMode` `"table"` in the workspace and
   `"[json]": {"chrJsonEditor.defaultMode": "text"}`, a `.json` file opens in Text mode and a
   `.jsonc` file in Table mode; with `"text"` a 6 MiB `.json` opens in Tree (large-file); a `.jsonl`
   file opens in Table; changing the value leaves open tabs in their mode, and the next tab opened
   uses it. With no setting, every 003 and 008 e2e case is unchanged.
4. **Threshold (e2e, UNK-087 ★):** with `chrJsonEditor.largeFileThreshold` `6`, a document of
   6,291,456 bytes opens in the normal editor and one of 6,291,457 in large-file mode; "Smart Format"
   on a 6 MiB document runs, and on 6,291,457 bytes it shows 010 criterion 10's message; with `1`, a
   2 MiB document opens in large-file mode and its Transform dialog lists no JavaScript, Lodash or
   JSONPath (RFC 9535). Validation of a 6 MiB large-file document still runs on open (its own 10 MiB
   limit, UNK-041). With no setting, 008 criterion 1 passes as written (5,242,880 / 5,242,881).
5. **Smart Format line length (core golden + e2e):** golden cases in `tests/golden/smart-format/`
   with an `options.json` of `{ "maxLineLength": 60 }` and `{ "maxLineLength": 200 }` give their
   expected bytes; every existing case (no `options.json`) is unchanged; in the e2e, with
   `"[jsonc]": {"chrJsonEditor.smartFormat.maxLineLength": 60}`, "Smart Format" on the 60-column
   case's `.jsonc` input leaves the document byte-equal to its expected file.
6. **Indentation (core unit + e2e, UNK-088 ★):** core takes the fallback indent as an option and,
   with none, writes 2 spaces (every golden case unchanged); unit cases with 4 spaces and a tab for
   R1 (a one-line file gaining a multi-line object) and R15 (an empty document). In the e2e, with
   `"[json]": {"editor.tabSize": 4, "editor.insertSpaces": true}`, adding an object member to a
   one-line `.json` in tree mode, an empty `.json`'s first edit, "Convert CSV to JSON" (009),
   "Convert to JSON" on a `.jsonl` file (012 J1), "Generate JSON Schema" (016) and "Convert YAML
   to JSON" (017) each write 4-space indented text; with
   `"editor.insertSpaces": false` a tab; a document already indented by 3 spaces keeps 3.
7. **Query language (test:web + e2e):** with `chrJsonEditor.transform.defaultQueryLanguage`
   `"jmespath"`, the first Transform dialog of a tab starts with JMESPath; after picking JSONPath
   (RFC 9535) and changing the setting to `"lodash"`, that tab's next dialog keeps JSONPath (RFC
   9535) and a new tab starts with Lodash; with `"lodash"` on a document above the threshold, the
   dialog starts with JSONQuery.
8. **Validation (e2e):** with `chrJsonEditor.validation.enable` `false`, a document that fails its
   schema shows no markers, no "assumed draft-07" notice and, at 12 MiB, no paused item; setting it
   to `true` with the tab open shows spec 004's errors without reopening; setting it back to
   `false` clears them.
9. **Display (test:web):** on the standalone page, a settings message with `flattenColumns: false`
   shows a nested object in one table column, and `escapeControlCharacters` and
   `escapeUnicodeCharacters` on show `"a\nb"` and `"é"` as `a\nb` and `é` in tree and table
   mode; text mode's text, the editor's data and the host's document (no `edit` message) are
   unchanged, and each change shows within 500 ms (A2).
10. **Web (web e2e):** in the web extension, a workspace `chrJsonEditor.defaultMode` of `"text"` opens
    a `.json` file in Text mode, and `chrJsonEditor.largeFileThreshold` of `1` opens a 2 MiB file in
    large-file mode; "CHR JSON Editor: Open Settings" opens the Settings editor; spec 013's command
    coverage map lists `chrJsonEditor.openSettings` with that test.
11. **Open Settings (e2e):** the command leaves the Settings editor as the active tab, its search
    holding `@ext:christian-vrl.chr-json-editor`.
12. **Offline, licenses, CSP:** no new runtime dependency; `pnpm check:offline` and
    `pnpm check:licenses` pass with no new entry; every webview CSP is unchanged.

## Where we differ from jsoneditoronline.org
- The site keeps its settings in one "Configuration modal" for the whole site. Ours are VS Code
  settings: per user, workspace, folder and language, synced by Settings Sync, and set in VS Code's
  Settings editor (C1) rather than a dialog in the page.
- Font size: the site has its own; ours follows VS Code's `editor.fontSize` and the workbench font
  (spec 003's theme), so there is no key for it.
- Indentation: the site has its own; ours follows the document (002 R1) and, for new text,
  VS Code's indentation settings (I1).
- JSON parser: the site offers "Auto select" (lossless up to 10 MB), "Native" and "Lossless". Ours
  is always lossless (spec 015): a native parser only rounds big numbers, and 015's measurements
  found no speed reason to give that up (UNK-068).
- The query language is a setting here (Q1); the site picks it in the Transform dialog's "Options",
  as our dialog also does.

## Settings this spec does not add, and why
| Behavior | Stays fixed because |
|---|---|
| Big-number parser (015) | lossless costs nothing measured (UNK-068); native only loses digits |
| Smart Format options other than line length (010 L8) | they interact (tables, compact arrays) and each would need its own golden set; line length is the one the site exposes |
| Generated schema dialect (016, UNK-069) | the owner chose draft-07; the `$schema` line can be edited after |
| Validation pause size (UNK-041), compare limit (UNK-037), YAML limit (UNK-077), 50 MB ceiling | measured limits of one feature, or VS Code's own |
| CSV options (009) | chosen per run in the dialog, as on the site |
| Comments, trailing commas, key order (UNK-015, UNK-045, UNK-046) | owner decisions that keep the user's data and text safe, not tastes |
| Query time and memory limits (011) | they keep the sealed engine safe |
| Downloading schemas | never: the extension is offline (AGENTS rule 3) |
| Default editor for `.json` | VS Code's `workbench.editorAssociations` already does it (UNK-004); the README shows how |
| Keybindings (018) | VS Code's Keyboard Shortcuts editor binds any command; no default keybinding is added |
| The library's main menu, navigation bar and status bar | the editor's actions and spec 018's paths live there |
| Theme | follows VS Code's (spec 003 criterion 7) |

## Scope
- **In:** the configuration section and its keys; the host's settings reader; M1, T1, F1, I1, Q1,
  V1, D1, D2 and C1; the page's settings (typed `EditorSettings` in `init` and one host → page
  message, one protocol bump); live application (A1–A6); golden, unit, web, e2e and web e2e cases;
  the README's settings section (spec 005) with the `workbench.editorAssociations` example.
- **Out:** a settings page inside the webview; the Chrome app's settings (020: the app-shell takes
  `EditorSettings` from its host, so 020 decides where its values come from); declaring
  `untrustedWorkspaces` (UNK-086); per-document settings stored in the file; remembering the last
  query language across tabs or windows; the settings in "Settings this spec does not add".

## Current evidence (D2 — path + lines / section)
- Today: `packages/vscode-extension/package.json` `contributes` has `customEditors`, `commands` and
  `menus` only, and `capabilities` is `{ "virtualWorkspaces": true }` (lines 22-24);
  `src/editorProvider.ts:377-378` (`mode: 'tree'`, `settings: {}`), `:334-341` (the only
  `onDidChangeConfiguration`, for `json.schemas` and `json5.schemas`);
  `packages/app-shell/src/protocol.ts:44` (`EditorSettings` is any JSON object), `:30`
  (`PROTOCOL_VERSION = 15`); `packages/app-shell/src/App.svelte:129-139` (`QUERY_LANGUAGES`, the first
  is JSONQuery), `:163` (`chosenQueryLanguageId`), `:237-250` (modes per tab), `:315-333` (the
  library's props: no `flattenColumns` or escape props, so the library's defaults).
- Threshold uses: `src/largeFile.ts:10` (`LARGE_FILE_THRESHOLD`), `src/smartFormatPlan.ts:7,31`,
  `packages/app-shell/src/query/size-gate.ts:9` (`QUERY_SIZE_LIMIT_BYTES`, "Spec 008's threshold");
  compare's own `COMPARE_LIMIT_BYTES` (`src/compareModel.ts:167`, UNK-037).
- Indent: `packages/core/src/formats/style.ts:65-76` (`detectIndent`: "with none, 2"),
  `src/csvPlan.ts:28` (`indent: 2`), spec 016 Terms (`JSON.stringify(schema, null, 2)`), spec 017
  Terms (`OUTPUT_STYLE` 2-space), spec 012 J1 ("indented by two").
- Site: jsoneditoronline.org/docs/ (fetched 2026-10-14), "Configuration modal": "Clicking 'Configure
  editor' in the 'Settings' menu will open the Configuration modal", with font size, "Indentation …
  whether to use spaces or tabs, and how many spaces", "max line length" for smart formatting,
  "Escape control characters … only applicable for Tree mode", "Escape unicode", "Flatten columns"
  ("flatten nested object properties into separate columns, or render them inline in a single
  column"), and "JSON parser" (Auto select / Native / Lossless, "only be applied after reloading the
  currently opened documents"). The query language is chosen under the Transform modal's "Options".
  No theme, menu-bar or status-bar setting is described.
- Library: `vanilla-jsoneditor@3.13.0/index.d.ts:483-517` (`JSONEditorPropsOptional`): `indentation`
  (default 2), `tabSize` (4), `mode` (`tree`), `mainMenuBar`, `navigationBar`, `statusBar` (all
  `true`), `escapeControlCharacters` and `escapeUnicodeCharacters` (`false`), `flattenColumns`
  (`true`), `queryLanguageId` (`"jsonquery"`); defaults read from the component's prop declarations
  in `index.js`. All are props, so `updateProps` changes them live.
- VS Code (code.visualstudio.com/api/references/contribution-points#contributes.configuration,
  fetched 2026-10-14): scopes `application`, `machine`, `machine-overridable`, `window`, `resource`
  ("can be configured in all settings levels, even folder settings"), `language-overridable`
  ("Resource settings that can be overridable at a language level"); `window` when none is given;
  `enum`, `markdownDescription`, `minimum`/`maximum`, `ignoreSync`. `@types/vscode@1.95.0`:
  `getConfiguration(section, scope)` with `{ uri, languageId }`, `inspect` with the four
  `…LanguageValue` fields, `affectsConfiguration(section, scope)`.
- Workspace Trust (code.visualstudio.com/api/extension-guides/workspace-trust, fetched 2026-10-14):
  with no `untrustedWorkspaces` key the extension "will be disabled when a workspace is in
  Restricted Mode"; `"limited"` takes `restrictedConfigurations`, for which VS Code "will only return
  the user-defined value of the setting in Restricted Mode", and granting trust fires a
  configuration change event.
- vscode.dev (code.visualstudio.com/docs/setup/vscode-web, fetched 2026-10-14): installed extensions
  are "saved in the browser's local storage"; the page does not say where settings are kept.

## Changes to approved specs (AGENTS rule 7; to be approved with this spec on the approval card)
- **008 Terms and criterion 1:** "'Threshold' is 5 MiB = 5,242,880 bytes (UNK-014)" → "'Threshold' is
  the `chrJsonEditor.largeFileThreshold` setting in bytes, 5 MiB = 5,242,880 by default (spec 019
  T1)"; criterion 1 is checked at the default. The specs that use 008's threshold (009, 010
  criterion 10, 011 criterion 11, 012, 014 criterion 8, 015, 016, 017, 018) follow it with no
  wording change, since they define it as 008's.
- **010 L8:** "Options are fixed … spec 019 may add line length and the others later" → "Options are
  fixed except the line length, `chrJsonEditor.smartFormat.maxLineLength` (default 120, spec 019 F1)".
- **Only if UNK-088 is ★:** 002 R1 "A file with no line breaks has indent unit 2 spaces" and R15
  "`JSON.stringify(value, null, 2)`", 012 J1 "indented by two", 016 Terms "`JSON.stringify(schema,
  null, 2)`" and 017 Terms "`OUTPUT_STYLE` is 2-space indent" → "the indent unit of VS Code's
  `editor.tabSize` and `editor.insertSpaces` for the language (spec 019 I1); core's default stays
  2 spaces".

## UNKNOWNS (record in UNKNOWNS.md; escalate, do not decide)
| ID | Unknown | Blocks | Options (awaiting human) |
|---|---|---|---|
| UNK-087 | Whether the large-file threshold becomes a setting | T1, criterion 4; T3 | owner: ★ a setting, 1–50 MiB, default 5 · fixed at 5 MiB |
| UNK-088 | Where the indent of new text comes from | I1, criterion 6; T5 | owner: ★ VS Code's `editor.tabSize`/`editor.insertSpaces` · our own setting, default 2 spaces · fixed 2 spaces |

## Gate (this spec's Definition of Done)
- [x] Acceptance criterion defined and falsifiable
- [ ] Result-affecting UNKNOWNS resolved
- [ ] Human approval recorded
