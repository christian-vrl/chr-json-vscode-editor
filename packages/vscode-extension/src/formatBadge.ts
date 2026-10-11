// Status-bar format badge (spec 003 T10, criterion 8): what the badge says for a document and what
// re-parsing it as a format finds. Pure functions with no `vscode` import, so unit tests can call
// them; formatBadgeVscode.ts binds them to the status bar. A re-parse only reads the text: it never
// edits the document, so choosing another format leaves its bytes unchanged.
// This package is CommonJS and core is ESM: type-only imports of ESM from CJS need `resolution-mode`,
// and the runtime functions come in as `FormatCore` (esbuild bundles core into the extension).
import type {
  DetectionSource,
  Format,
  FormatAdapter,
  ParseDataResult,
} from '@chr-json-editor/core' with {
  'resolution-mode': 'import',
};

export type { Format };

/** The parts of core the badge uses. */
export interface FormatCore {
  detect(
    path: string,
    languageId?: string,
    text?: string,
  ): { format: Format; source: DetectionSource };
  getAdapter(format: Format): FormatAdapter;
  /** Core's data-only parse, for a document open in a locked large-file tab (spec 008). */
  parseData(format: Format, text: string): ParseDataResult;
}

export const FORMATS: readonly Format[] = ['json', 'jsonc', 'json5'];

export const FORMAT_LABELS: Readonly<Record<Format, string>> = {
  json: 'JSON',
  jsonc: 'JSONC',
  json5: 'JSON5',
};

/** What a re-parse as one format found. `unsupported` means core has no parser for it yet. */
export type ParseOutcome =
  { kind: 'parsed'; errors: number; warnings: number } | { kind: 'unsupported'; reason: string };

/** The format state of one open document. */
export interface FormatState {
  format: Format;
  /** What `detect` picked; `format` differs from it once the user chose another format. */
  detected: Format;
  source: DetectionSource;
  outcome: ParseOutcome;
}

/** The status-bar item's text and tooltip. */
export interface Badge {
  text: string;
  tooltip: string;
}

const SOURCE_LABELS: Readonly<Record<DetectionSource, string>> = {
  languageId: 'the language mode',
  fileName: 'the file name',
  extension: 'the file extension',
  content: 'the content',
  default: 'the default',
};

/**
 * Parses `text` as `format`; never throws. A format whose `getAdapter` throws is `unsupported`.
 * With `dataOnly` (a locked large-file tab, spec 008 criterion 8) it reads the data alone with
 * `parseData`, which keeps no parse: the outcome is valid or one error, and warnings go uncounted.
 */
export function reparse(
  core: FormatCore,
  text: string,
  format: Format,
  dataOnly = false,
): ParseOutcome {
  let adapter: FormatAdapter;
  try {
    adapter = core.getAdapter(format);
  } catch (error) {
    return { kind: 'unsupported', reason: error instanceof Error ? error.message : String(error) };
  }
  if (dataOnly) {
    return { kind: 'parsed', errors: 'error' in core.parseData(format, text) ? 1 : 0, warnings: 0 };
  }
  const { diagnostics } = adapter.parse(text);
  return {
    kind: 'parsed',
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
  };
}

/** Detects the format of a newly opened document (spec 002 R11) and parses it as that format. */
export function initialState(
  core: FormatCore,
  path: string,
  languageId: string,
  text: string,
  dataOnly = false,
): FormatState {
  const { format, source } = core.detect(path, languageId, text);
  return { format, detected: format, source, outcome: reparse(core, text, format, dataOnly) };
}

/** The state after the user chose `format`, or after the text changed (same `format`). */
export function withFormat(
  core: FormatCore,
  state: FormatState,
  text: string,
  format: Format,
  dataOnly = false,
): FormatState {
  return { ...state, format, outcome: reparse(core, text, format, dataOnly) };
}

export function badge(state: FormatState): Badge {
  const label = FORMAT_LABELS[state.format];
  const how =
    state.format === state.detected
      ? `Detected from ${SOURCE_LABELS[state.source]}.`
      : `Chosen by you; detected as ${FORMAT_LABELS[state.detected]}.`;
  const pick = 'Click to parse it as another format.';
  const { outcome } = state;
  if (outcome.kind === 'unsupported') {
    return {
      text: `$(circle-slash) ${label} (no parser yet)`,
      tooltip: `${label}: ${how} CHR JSON Editor has no ${label} parser yet. ${pick}`,
    };
  }
  if (outcome.errors > 0) {
    return {
      text: `$(error) ${label}`,
      tooltip: `${label}: ${how} ${count(outcome.errors, 'parse error')} as ${label}. ${pick}`,
    };
  }
  if (outcome.warnings > 0) {
    return {
      text: `$(warning) ${label}`,
      tooltip: `${label}: ${how} ${count(outcome.warnings, 'warning')} as ${label}. ${pick}`,
    };
  }
  return { text: label, tooltip: `${label}: ${how} ${pick}` };
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
