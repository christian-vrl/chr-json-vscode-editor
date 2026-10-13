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

"Convert to JSON", "Convert to JSONC" and "Convert to JSON5" write the file in another format as a
new file beside it (`data.json5` becomes `data.json`), keeping its layout and every comment the
target can hold. Going to JSON removes comments, and `NaN` and `Infinity` become `null` in JSON and
JSONC; the command asks first when that happens. The original file is never changed.

`.jsonl` and `.ndjson` files (JSON Lines, one JSON value per line) open in the table view, with the
tree view as the other choice; an edit rewrites only the lines it changes. A line that is not valid
JSON makes the file read-only until it is fixed: "Repair Lines" repairs what it can as one undoable
edit, and "Open as Text" opens the text editor at that line. "Convert to JSON Lines" writes an array
as one item per line, and "Convert to JSON", "Convert to JSONC" and "Convert to JSON5" turn JSON
Lines into an array.

"Compare With…", "Compare Selected" (two files in the explorer) and "Compare with HEAD" show two
documents side by side as trees with every data difference marked, ignoring key order, comments and
formatting; unsaved changes are included, and edits made anywhere show up in the compare. "Next" and
"Previous" step through the differences, and "Copy to left" or "Copy to right" copies one across as a
normal, undoable edit that keeps the target's comments. The HEAD side is read from the local Git
repository and is never changed.

"Export to CSV…" turns an array of objects into CSV, and "Import CSV…" (in CHR JSON Editor) and
"Convert CSV to JSON" (on a `.csv` file) turn CSV into JSON. A panel shows the delimiter, header row
and flattening options with a preview of the first 100 rows. Export takes the array the table view
shows, or the array or object selected in the tree view, else the whole document; it can save
`<name>.csv` beside the file or copy the CSV. Export writes the data as it was when the panel
opened, which is what its preview shows; run "Export to CSV…" again after editing to export the
edits. Import creates `<name>.json` beside the CSV file, or replaces the document's data as one
undoable edit that keeps the comments of members that stay. A large file that opened read-only
exports as usual but offers no "Import CSV…" until "Edit anyway".

Files open in the text editor by default. To open a file type in CHR JSON Editor every time, use
"Reopen Editor With..." > "Configure default editor", or set VS Code's `workbench.editorAssociations`
setting, for example `{ "*.json5": "chrJsonEditor.editor" }`.
