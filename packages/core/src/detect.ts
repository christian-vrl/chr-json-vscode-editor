// Format detection (spec 002 R11) with strict-JSON diagnostics (spec 002 §Scope: strict-JSON
// violations in a `.json` document are warnings, not load failures).
import { createScanner, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import type { Diagnostic, Format } from './formats/types.js';

/** Which R11 step decided the format; `default` means no step applied and there was no text. */
export type DetectionSource = 'languageId' | 'fileName' | 'extension' | 'content' | 'default';

/** A strict-JSON violation; `code` is jsonc-parser's error name or `TrailingComma`. */
export interface StrictJsonDiagnostic extends Diagnostic {
  severity: 'warning';
  code: string;
}

export interface Detection {
  format: Format;
  source: DetectionSource;
  /** Strict-JSON violations; only filled when the format is `json` and text was given. */
  diagnostics: StrictJsonDiagnostic[];
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
 * names → extension → content (empty or whitespace only → json, else strict JSON → json, else
 * JSONC → jsonc, else json5).
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
  // UNK-020: empty or whitespace-only text (RFC 8259 whitespace) is json, e.g. a new document.
  if (/^[ \t\n\r]*$/.test(body)) return { format: 'json', source: 'content', diagnostics: [] };
  if (parseErrors(body, STRICT).length === 0)
    return { format: 'json', source: 'content', diagnostics: [] };
  if (parseErrors(body, JSONC).length === 0)
    return { format: 'jsonc', source: 'content', diagnostics: [] };
  return { format: 'json5', source: 'content', diagnostics: [] };
}

/** Strict RFC 8259 violations in `text`, as warnings with offsets into `text`. */
export function strictJsonDiagnostics(text: string): StrictJsonDiagnostic[] {
  const body = stripBom(text);
  const shift = text.length - body.length;
  const commas = trailingCommas(body);
  // jsonc-parser reports a trailing comma as PropertyNameExpected/ValueExpected at the closing
  // bracket; those are replaced by one TrailingComma warning on the comma itself.
  const closers = new Set(commas.map((c) => c.closer));
  const diagnostics: StrictJsonDiagnostic[] = commas.map((c) => ({
    severity: 'warning',
    code: 'TrailingComma',
    message: 'Trailing commas are not allowed in JSON.',
    offset: c.comma + shift,
    length: 1,
  }));
  for (const e of parseErrors(body, STRICT)) {
    const code = printParseErrorCode(e.error);
    if (closers.has(e.offset) && (code === 'PropertyNameExpected' || code === 'ValueExpected'))
      continue;
    diagnostics.push({
      severity: 'warning',
      code,
      message: messageFor(code),
      offset: e.offset + shift,
      length: e.length,
    });
  }
  return diagnostics.sort((a, b) => a.offset - b.offset);
}

// Numeric values of jsonc-parser's `SyntaxKind` const enum (lib/umd/main.d.ts).
const COMMA = 5;
const CLOSE_BRACE = 2;
const CLOSE_BRACKET = 4;
const EOF = 17;
const TRIVIA = new Set([12, 13, 14, 15]); // line comment, block comment, line break, whitespace

/** Commas followed (after trivia and comments) by `}` or `]`, with the closer's offset. */
function trailingCommas(text: string): { comma: number; closer: number }[] {
  const scanner = createScanner(text, false);
  const found: { comma: number; closer: number }[] = [];
  let lastComma = -1;
  for (let kind: number = scanner.scan(); kind !== EOF; kind = scanner.scan()) {
    if (TRIVIA.has(kind)) continue;
    if ((kind === CLOSE_BRACE || kind === CLOSE_BRACKET) && lastComma >= 0) {
      found.push({ comma: lastComma, closer: scanner.getTokenOffset() });
    }
    lastComma = kind === COMMA ? scanner.getTokenOffset() : -1;
  }
  return found;
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
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
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
