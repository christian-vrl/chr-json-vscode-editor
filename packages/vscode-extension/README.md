# CHR JSON Editor

A free, fully offline JSON, JSONC and JSON5 editor for VS Code, inspired by
[jsoneditoronline.org](https://jsoneditoronline.org) (not affiliated).

Work in progress: "Open in CHR JSON Editor" shows `.json`, `.jsonc` and `.json5` files in tree, text
and table views, and "Reopen as Text" switches back. An edit in the tree or table view is a normal
edit of the file that keeps its comments and formatting, and changes made elsewhere show up in the
views.

Format, compact, sort, search and replace, and transform (JSONQuery, JMESPath or JSONPath) keep the
file's comments, except those on members a transform removes. A file that does not parse can be
repaired when it opens in CHR JSON Editor, or with "Repair JSON" in the text editor; the repair
keeps comments and JSON5 values, and asks first when it cannot keep a comment.

The status bar shows the format the file was detected as (JSON, JSONC or JSON5). Click it, or run
"Change Format", to parse the file as another format; this never changes the file.

Files open in the text editor by default. To open a file type in CHR JSON Editor every time, use
"Reopen Editor With..." > "Configure default editor", or set VS Code's `workbench.editorAssociations`
setting, for example `{ "*.json5": "chrJsonEditor.editor" }`.
