// Format detection (spec 002 R11) with strict-JSON diagnostics (spec 002 §Scope: strict-JSON
// violations in a `.json` document are warnings, not load failures).
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

export type Format = 'json' | 'jsonc' | 'json5';

/** Which R11 step decided the format; `default` means no step applied and there was no text. */
export type DetectionSource = 'languageId' | 'fileName' | 'extension' | 'content' | 'default';

export interface Diagnostic {
  severity: 'warning';
  /** jsonc-parser's error name, e.g. `InvalidCommentToken`. */
  code: string;
  message: string;
  offset: number;
  length: number;
}

export interface Detection {
  format: Format;
  source: DetectionSource;
  /** Strict-JSON violations; only filled when the format is `json` and text was given. */
  diagnostics: Diagnostic[];
}

const FORMATS: readonly string[] = ['json', 'jsonc', 'json5'];

// VS Code's JSONC file names (R11). They end in `.json`, so they are checked before the extension
// step; otherwise `.json` would always win and this step could never apply (UNK-019).
const JSONC_FILE_NAMES = new Set([
  'settings.json',
  'tsconfig.json',
  'jsconfig.json',
  'launch.json',
  'tasks.json',
  'extensions.json',
  'devcontainer.json',
  '.eslintrc.json',
]);

const STRICT = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };
const JSONC = { disallowComments: false, allowTrailingComma: true, allowEmptyContent: false };

/**
 * Detects the format of a document per spec 002 R11: explicit `languageId` → VS Code JSONC file
 * names → extension → content (strict JSON → json, else JSONC → jsonc, else json5).
 * `path` may be a POSIX path, a Windows path or a URI; only its last segment is used.
 */
export function detect(path: string, languageId?: string, text?: string): Detection {
  const format = fromLanguageId(languageId);
  if (format) return withDiagnostics(format, 'languageId', text);

  const name = baseName(path).toLowerCase();
  if (JSONC_FILE_NAMES.has(name)) return withDiagnostics('jsonc', 'fileName', text);

  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  if (FORMATS.includes(extension)) return withDiagnostics(extension as Format, 'extension', text);

  if (text === undefined) return { format: 'json', source: 'default', diagnostics: [] };
  const body = stripBom(text);
  if (parseErrors(body, STRICT).length === 0)
    return { format: 'json', source: 'content', diagnostics: [] };
  if (parseErrors(body, JSONC).length === 0)
    return { format: 'jsonc', source: 'content', diagnostics: [] };
  return { format: 'json5', source: 'content', diagnostics: [] };
}

/** Strict RFC 8259 violations in `text`, as warnings with offsets into `text`. */
export function strictJsonDiagnostics(text: string): Diagnostic[] {
  const shift = text.length - stripBom(text).length;
  return parseErrors(stripBom(text), STRICT).map((e) => {
    const code = printParseErrorCode(e.error);
    return {
      severity: 'warning',
      code,
      message: messageFor(code),
      offset: e.offset + shift,
      length: e.length,
    };
  });
}

function withDiagnostics(
  format: Format,
  source: DetectionSource,
  text: string | undefined,
): Detection {
  const diagnostics = format === 'json' && text !== undefined ? strictJsonDiagnostics(text) : [];
  return { format, source, diagnostics };
}

function fromLanguageId(languageId: string | undefined): Format | undefined {
  return languageId !== undefined && FORMATS.includes(languageId)
    ? (languageId as Format)
    : undefined;
}

function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

// RFC 8259 §8.1: parsers MAY ignore a leading byte order mark.
function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}

function parseErrors(text: string, options: typeof STRICT): ParseError[] {
  const errors: ParseError[] = [];
  parse(text, errors, options);
  return errors;
}

function messageFor(code: string): string {
  return code === 'InvalidCommentToken'
    ? 'Comments are not allowed in JSON.'
    : `Invalid JSON: ${code}.`;
}
