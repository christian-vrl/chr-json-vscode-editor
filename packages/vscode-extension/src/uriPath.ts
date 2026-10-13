// File names from a URI's path (spec 013 T2), in place of Node's `path.posix` so the shared host code
// runs in the web host too. `uri.path` is always `/`-separated on every platform and scheme, so only
// `/` is a separator, as in Node's `path.posix`, whose results these match.

function trimTrailingSlashes(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' && path.startsWith('/') ? '/' : trimmed;
}

/** The last segment of `path`: `b.json` for `/a/b.json`. */
export function basename(path: string): string {
  const trimmed = trimTrailingSlashes(path);
  return trimmed === '/' ? '' : trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** `path` without its last segment: `/a` for `/a/b.json`. */
export function dirname(path: string): string {
  if (path === '') return '.';
  const trimmed = trimTrailingSlashes(path);
  const slash = trimmed.lastIndexOf('/');
  if (slash === -1) return '.';
  return slash === 0 ? '/' : trimTrailingSlashes(trimmed.slice(0, slash));
}

/** The extension of the last segment, dot included: `.json` for `/a/b.json`, '' for `/a/.hidden`. */
export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || name === '..' ? '' : name.slice(dot);
}
