// VS Code's sync limit for extensions (spec 008 criterion 9, T4). VS Code does not hand a document
// to extensions when its text is longer than 50 × 2^20 UTF-16 code units (TextModel's
// `_MODEL_SYNC_LIMIT`, measured by 008 T4 on VS Code 1.141.0): `openTextDocument` rejects with
// "Files above 50MB cannot be synchronized with extensions", so a custom text editor cannot open it.
// "Open in CHR JSON Editor" checks the file's size on disk before opening, since the text is not
// loaded yet. UTF-8 never takes fewer bytes than UTF-16 code units, so a file at or below the limit
// on disk always opens; a file above it on disk whose text still fits (a byte order mark, or
// multi-byte characters) is refused too.

/** The largest size, in bytes on disk, that "Open in CHR JSON Editor" opens: 52,428,800. */
export const SYNC_LIMIT = 50 * 1024 * 1024;

/** `bytes` in MiB with one decimal, rounded down (spec 008 criterion 3's format). */
export function mib(bytes: number): string {
  return (Math.floor((bytes * 10) / (1024 * 1024)) / 10).toFixed(1);
}

/** The message shown instead of opening `name` of `bytes` bytes (criterion 9). */
export function ceilingMessage(name: string, bytes: number): string {
  return (
    `${name} is ${mib(bytes)} MiB. VS Code does not pass files above 50 MB to extensions, ` +
    `so CHR JSON Editor can't open it.`
  );
}
