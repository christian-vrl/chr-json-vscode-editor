# CHR JSON Editor

A free, fully offline JSON, JSONC and JSON5 editor for VS Code, inspired by
[jsoneditoronline.org](https://jsoneditoronline.org) (not affiliated).

Work in progress: "Open in CHR JSON Editor" shows `.json`, `.jsonc` and `.json5` files in tree, text
and table views, and "Reopen as Text" switches back. An edit in the tree or table view is a normal
edit of the file that keeps its comments and formatting, and changes made elsewhere show up in the
views.

The status bar shows the format the file was detected as (JSON, JSONC or JSON5). Click it, or run
"Change Format", to parse the file as another format; this never changes the file.

Files open in the text editor by default. To open a file type in CHR JSON Editor every time, use
"Reopen Editor With..." > "Configure default editor", or set VS Code's `workbench.editorAssociations`
setting, for example `{ "*.json5": "chrJsonEditor.editor" }`.
