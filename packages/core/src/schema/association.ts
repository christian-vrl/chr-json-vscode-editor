// Schema association (spec 004 criterion 1, task T3). Finds which JSON Schema applies to a document,
// first match wins: the document's top-level `$schema` when it is a local path → the `json.schemas`
// setting → the `json5.schemas` setting → none. The resolver only names a location; it never reads
// or fetches anything, so a remote URL comes back as `kind: 'remote'` for the validator to report as
// not loaded (criterion 3).
//
// URIs here are VS Code's `Uri.toString(true)` spelling (`file:///c:/dir/a b.json`: lowercase drive
// letter, no percent-encoding), which is what VS Code's own JSON service matches `fileMatch` against.
// Relative paths keep the scheme and authority of what they are relative to, so a workspace on a
// virtual scheme (github.dev's `vscode-vfs://github/o/r/…`, spec 013 criterion 6) names its schema
// files on that scheme; `http:` and `https:` are always remote.

/** One entry of `json.schemas` or `json5.schemas`, as read from settings (unvalidated). */
export interface SchemaSetting {
  fileMatch?: unknown;
  url?: unknown;
  schema?: unknown;
}

/** The entries of one settings level, with what VS Code attaches to that level. */
export interface SchemaSettingsScope {
  /** The entries, in settings order. */
  entries: unknown;
  /** Where `url` values starting with `.` or `/` resolve (a workspace folder or the workspace file's folder). */
  baseUri?: string;
  /** When set, the entries apply only to documents inside this folder (workspace-folder settings). */
  folderUri?: string;
}

export interface SchemaAssociationInput {
  /** The document's URI (`file:` on desktop, a virtual scheme on the web). */
  documentUri: string;
  /** The value of the document's top-level `$schema` member, if it has one. */
  documentSchema?: unknown;
  /** `json.schemas` levels in VS Code's order: user, workspace, workspace folders. */
  jsonSchemas?: readonly SchemaSettingsScope[];
  /** `json5.schemas` levels, same order. */
  json5Schemas?: readonly SchemaSettingsScope[];
}

export type SchemaLocation =
  /** A local file to read: a `file:` URI, or one on the workspace's virtual scheme. */
  | { kind: 'file'; uri: string }
  /** A schema written inline in settings (`schema`); `uri` is the entry's `url`, if any. */
  | { kind: 'inline'; schema: unknown; uri?: string }
  /** Anything that would need the network or another scheme; never loaded (offline). */
  | { kind: 'remote'; uri: string };

export type SchemaAssociation =
  | { source: '$schema' | 'json.schemas' | 'json5.schemas'; location: SchemaLocation }
  | { source: 'none' };

/** Resolves the schema for one document (criterion 1). Pure: reads no files, fetches nothing. */
export function resolveSchemaAssociation(input: SchemaAssociationInput): SchemaAssociation {
  const documentUri = stripQueryAndFragment(input.documentUri);
  const fromDocument = localSchemaPath(input.documentSchema, documentUri);
  if (fromDocument !== undefined) {
    return { source: '$schema', location: { kind: 'file', uri: fromDocument } };
  }
  for (const [source, scopes] of [
    ['json.schemas', input.jsonSchemas],
    ['json5.schemas', input.json5Schemas],
  ] as const) {
    const location = matchSettings(scopes ?? [], documentUri);
    if (location) {
      return { source, location };
    }
  }
  return { source: 'none' };
}

/**
 * The `$schema` value as a local URI, or undefined when it is not a local path (a remote URL such as
 * a meta-schema id, another scheme, an empty or non-string value). Relative and absolute paths
 * resolve on the document's own scheme and authority (an absolute one from its root), unless the
 * document has no folder (untitled) or is itself remote; Windows paths and `file:` documents give
 * `file:` URIs.
 */
export function localSchemaPath(value: unknown, documentUri: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const path = stripFragment(value.trim());
  if (path === '') {
    return undefined;
  }
  if (WINDOWS_DRIVE.test(path)) {
    return fileUri('/' + path.replace(/\\/g, '/'));
  }
  if (path.startsWith('\\\\')) {
    const [host = '', ...rest] = path.slice(2).replace(/\\/g, '/').split('/');
    return 'file://' + host.toLowerCase() + normalizeSegments('/' + rest.join('/'));
  }
  const scheme = SCHEME.exec(path)?.[1];
  if (scheme !== undefined) {
    return scheme.toLowerCase() === 'file' ? normalizeFileUri(path) : undefined;
  }
  if (path.startsWith('/') || path.startsWith('\\')) {
    // An absolute path is on the document's own scheme and authority, as VS Code's JSON service
    // resolves it (`/x` on `vscode-vfs://github/o/r/a.json` is `vscode-vfs://github/o/r/x`): `file:`
    // for a `file:` document or one with no folder.
    const absolute = path.replace(/\\/g, '/');
    const prefix = HIERARCHICAL.exec(documentUri)?.[1];
    return prefix !== undefined && hasFolder(documentUri) && !/^file:/i.test(prefix)
      ? prefix + normalizeSegments(absolute)
      : fileUri(absolute);
  }
  if (!hasFolder(documentUri)) {
    return undefined;
  }
  return joinUri(dirname(documentUri), path.replace(/\\/g, '/'));
}

/**
 * Whether `fileMatch` patterns select the document, with VS Code's rules: `*` matches within one
 * path segment, `**` across segments, `?`, `[...]` and `{a,b}` as in globs; each pattern may match
 * any trailing part of the URI (a leading `/` is dropped and `**\/` prepended); a pattern starting
 * with `!` excludes; the file matches when the last pattern that matches it is not an exclusion.
 */
export function fileMatchSelects(patterns: unknown, documentUri: string): boolean {
  if (!Array.isArray(patterns)) {
    return false;
  }
  let selected = false;
  for (const raw of patterns) {
    if (typeof raw !== 'string') {
      continue;
    }
    const include = !raw.startsWith('!');
    let pattern = include ? raw : raw.slice(1);
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }
    if (pattern === '') {
      continue;
    }
    let regexp: RegExp;
    try {
      regexp = globToRegExp('**/' + pattern);
    } catch {
      // An invalid pattern (an unclosed `[`) disables the whole entry, as in VS Code.
      return false;
    }
    if (regexp.test(documentUri)) {
      selected = include;
    }
  }
  return selected;
}

function matchSettings(
  scopes: readonly SchemaSettingsScope[],
  documentUri: string,
): SchemaLocation | undefined {
  for (const scope of scopes) {
    if (!Array.isArray(scope.entries)) {
      continue;
    }
    const folder = scope.folderUri && withTrailingSlash(stripQueryAndFragment(scope.folderUri));
    if (folder && !documentUri.startsWith(folder)) {
      continue;
    }
    for (const entry of scope.entries as unknown[]) {
      if (!isObject(entry) || !fileMatchSelects(entry.fileMatch, documentUri)) {
        continue;
      }
      const location = settingLocation(entry, scope.baseUri);
      if (location) {
        return location;
      }
    }
  }
  return undefined;
}

/** Where a matching settings entry points; an inline `schema` wins over its `url`, as in VS Code. */
function settingLocation(
  entry: SchemaSetting,
  baseUri: string | undefined,
): SchemaLocation | undefined {
  const url =
    typeof entry.url === 'string' && entry.url.trim() !== '' ? entry.url.trim() : undefined;
  const resolved = url === undefined ? undefined : settingUrl(url, baseUri);
  const uri = resolved?.uri;
  if (isObject(entry.schema)) {
    return uri === undefined
      ? { kind: 'inline', schema: entry.schema }
      : { kind: 'inline', schema: entry.schema, uri };
  }
  if (resolved === undefined) {
    return undefined;
  }
  return resolved.local
    ? { kind: 'file', uri: resolved.uri }
    : { kind: 'remote', uri: resolved.uri };
}

/**
 * A settings `url`: `./x` and `/x` join the settings location when there is one (VS Code's
 * getSchemaId), on that location's scheme. A relative url with no settings location (user settings)
 * has nothing to resolve against, so it gives undefined and the entry is skipped. `local` says
 * whether the result is read from the workspace: a `file:` URI, or one joined onto a settings
 * location that is not remote; any other scheme written out in full stays remote.
 */
function settingUrl(
  url: string,
  baseUri: string | undefined,
): { uri: string; local: boolean } | undefined {
  if (baseUri !== undefined && (url.startsWith('.') || url.startsWith('/'))) {
    const base = withTrailingSlash(stripQueryAndFragment(baseUri));
    return { uri: joinUri(base, url.replace(/^\/+/, '')), local: !isRemote(base) };
  }
  if (WINDOWS_DRIVE.test(url) || url.startsWith('/')) {
    return {
      uri: fileUri((url.startsWith('/') ? '' : '/') + url.replace(/\\/g, '/')),
      local: true,
    };
  }
  const scheme = SCHEME.exec(url)?.[1];
  if (scheme === undefined) {
    return undefined;
  }
  return scheme.toLowerCase() === 'file'
    ? { uri: normalizeFileUri(url), local: true }
    : { uri: url, local: false };
}

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]+):/;
/** A URI with a hierarchical path: `scheme://authority/path` or `scheme:/path`. */
const HIERARCHICAL = /^([a-zA-Z][a-zA-Z0-9+.-]*:(?:\/\/[^/]*)?)(\/.*)?$/;

/** Schemes whose files would need the network: named, never read (offline). */
function isRemote(uri: string): boolean {
  return /^https?:/i.test(uri);
}

/**
 * Whether relative paths can resolve against the URI's folder: it has a hierarchical path and is
 * neither remote nor untitled (an untitled document's path is only a suggested save location).
 */
function hasFolder(uri: string): boolean {
  return HIERARCHICAL.exec(uri)?.[2] !== undefined && !isRemote(uri) && !/^untitled:/i.test(uri);
}

function fileUri(absolutePath: string): string {
  return 'file://' + lowerDrive(normalizeSegments(absolutePath));
}

function normalizeFileUri(uri: string): string {
  const match = /^file:(\/\/[^/]*)?(.*)$/i.exec(stripQueryAndFragment(uri));
  const authority = match?.[1] ?? '//';
  return 'file:' + authority + lowerDrive(normalizeSegments(match?.[2] || '/'));
}

function lowerDrive(path: string): string {
  return path.replace(/^\/([A-Z]):/, (_, drive: string) => `/${drive.toLowerCase()}:`);
}

/**
 * Joins a relative path onto a folder URI (which ends with `/`), resolving `.` and `..`; the
 * scheme and authority are kept as they are. Drive letters are lowercased in `file:` URIs only.
 */
function joinUri(folderUri: string, relative: string): string {
  const match = HIERARCHICAL.exec(folderUri);
  if (!match) {
    return folderUri + relative;
  }
  const prefix = match[1] as string;
  const path = normalizeSegments((match[2] ?? '/') + relative);
  return prefix + (/^file:/i.test(prefix) ? lowerDrive(path) : path);
}

/** Removes `.` and `..` segments; `..` never climbs above the root (or a drive letter). */
function normalizeSegments(path: string): string {
  const out: string[] = [];
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    if (part === '.' || (part === '' && index > 0 && index < parts.length - 1)) {
      continue;
    }
    if (part === '..') {
      if (out.length > 1 && !/^[a-zA-Z]:$/.test(out[out.length - 1] ?? '')) {
        out.pop();
      }
      continue;
    }
    out.push(part);
  }
  const last = parts[parts.length - 1];
  if ((last === '.' || last === '..') && out[out.length - 1] !== '') {
    out.push('');
  }
  return out.join('/') || '/';
}

function dirname(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/') + 1);
}

function withTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : uri + '/';
}

function stripFragment(value: string): string {
  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}

function stripQueryAndFragment(uri: string): string {
  const end = uri.search(/[?#]/);
  return end === -1 ? uri : uri.slice(0, end);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Glob to an anchored RegExp with VS Code's JSON-service rules: `**` as a whole segment matches any
 * number of segments (including none), any other `*` matches within one segment, `?` one character,
 * `[...]` a class, `{a,b}` alternatives. Everything else is literal.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  let inGroup = false;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      const previous = glob[i - 1];
      let stars = 1;
      while (glob[i + 1] === '*') {
        stars++;
        i++;
      }
      const next = glob[i + 1];
      const segmentStart =
        previous === undefined || previous === '/' || previous === '{' || previous === ',';
      const segmentEnd = next === undefined || next === '/' || next === ',' || next === '}';
      if (stars > 1 && segmentStart && segmentEnd) {
        if (next === '/') {
          i++;
        } else if (previous === '/' && source.endsWith('\\/')) {
          source = source.slice(0, -2);
        }
        source += '(?:[^/]*(?:/|$))*';
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '.';
    } else if (c === '[' || c === ']') {
      source += c;
    } else if (c === '{') {
      inGroup = true;
      source += '(?:';
    } else if (c === '}') {
      inGroup = false;
      source += ')';
    } else if (c === ',' && inGroup) {
      source += '|';
    } else {
      source += c.replace(/[\\^$.|+()=!/,]/g, '\\$&');
    }
  }
  return new RegExp('^' + source + '$');
}
