// The part of `node:path` the shared host code uses (013 T1 stand-in; 013 T2 replaces the imports
// with src/uriPath.ts and deletes this file). The browser build aliases `node:path` here
// (esbuild.web.mjs); the Node entry keeps Node's own module. Callers pass `uri.path` or a POSIX
// `fsPath`, so only `/` separators are handled, as Node's `path.posix` does.

function trimTrailingSlashes(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' && path.startsWith('/') ? '/' : trimmed;
}

export function basename(path: string): string {
  const trimmed = trimTrailingSlashes(path);
  return trimmed === '/' ? '' : trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
  if (path === '') return '.';
  const trimmed = trimTrailingSlashes(path);
  const slash = trimmed.lastIndexOf('/');
  if (slash === -1) return '.';
  return slash === 0 ? '/' : trimTrailingSlashes(trimmed.slice(0, slash));
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 || name === '..' ? '' : name.slice(dot);
}

export const posix = { basename, dirname, extname };
