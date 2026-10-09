// Golden-master loader (001 T4). Each case is a folder tests/golden/<format>/<name>/ holding
// input.<ext>, patch.json (RFC 6902), expected.<ext> and case.json (coverage tags, spec 002
// criterion 4). Inputs and expected outputs are read unchanged so tests can compare bytes (D3).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const goldenFormats = ['json', 'jsonc', 'json5'] as const;
export type GoldenFormat = (typeof goldenFormats)[number];

export interface PatchOperation {
  op: string;
  path: string;
  [key: string]: unknown;
}

export interface GoldenTags {
  op: string;
  [tag: string]: unknown;
}

export interface GoldenCase {
  format: GoldenFormat;
  name: string;
  input: string;
  patch: PatchOperation[];
  expected: string;
  tags: GoldenTags;
}

export const goldenRoot = import.meta.dirname;

/** Folders under the golden root that hold another corpus, with its own loader: `convert/` is the
 *  conversion corpus of spec 006 (`convert.ts`). */
export const otherCorpora: readonly string[] = ['convert'];

/** `op` tags of whole-document actions (spec 002 R12–R14, criterion 8). Their patch.json holds one
 *  action, not an RFC 6902 patch: `{"op": "compact", "path": ""}`, `{"op": "sort", "path",
 *  "property"?, "direction"?, "order"?}` (`SortOptions`), `{"op": "format", "path": ""}` (003 T8).
 *  `apply.test.ts` skips them; `actions.test.ts`
 *  runs them. */
export const wholeDocumentOps: readonly string[] = ['compact', 'sort', 'data-diff', 'format'];

/**
 * Loads every case under `root`, sorted by format then name. Throws on any malformed case, on a
 * directory under `root` that is not a format or another corpus (a misspelled format folder would
 * otherwise be skipped), and on a file directly inside a format folder (cases are folders).
 */
export function loadGoldenCases(root: string = goldenRoot): GoldenCase[] {
  const unknown = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && !isGoldenFormat(entry.name) && !otherCorpora.includes(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  if (unknown.length > 0) {
    throw new Error(
      `golden corpus: unknown folder ${unknown.join(', ')} (formats: ${goldenFormats.join(', ')})`,
    );
  }
  return goldenFormats.flatMap((format) => {
    const formatDir = path.join(root, format);
    const entries = readdirSync(formatDir, { withFileTypes: true });
    const stray = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
    if (stray.length > 0) {
      throw new Error(`golden corpus: ${format}/ holds files outside a case: ${stray.join(', ')}`);
    }
    return entries
      .map((entry) => entry.name)
      .sort()
      .map((name) => loadCase(path.join(formatDir, name), format, name));
  });
}

function isGoldenFormat(name: string): name is GoldenFormat {
  return (goldenFormats as readonly string[]).includes(name);
}

function loadCase(dir: string, format: GoldenFormat, name: string): GoldenCase {
  const where = `golden case ${format}/${name}`;
  const patch = readJson(dir, 'patch.json', where);
  if (!Array.isArray(patch) || !patch.every(isPatchOperation)) {
    throw new Error(`${where}: patch.json must be an array of {op, path} operations`);
  }
  const tags = readJson(dir, 'case.json', where);
  if (!isTags(tags)) {
    throw new Error(`${where}: case.json must be an object with a string "op" tag`);
  }
  return {
    format,
    name,
    input: readText(dir, `input.${format}`, where),
    patch,
    expected: readText(dir, `expected.${format}`, where),
    tags,
  };
}

function readText(dir: string, file: string, where: string): string {
  try {
    return readFileSync(path.join(dir, file), 'utf8');
  } catch (error) {
    throw new Error(`${where}: cannot read ${file}`, { cause: error });
  }
}

function readJson(dir: string, file: string, where: string): unknown {
  const text = readText(dir, file, where);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where}: ${file} is not valid JSON`, { cause: error });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPatchOperation(value: unknown): value is PatchOperation {
  return isObject(value) && typeof value.op === 'string' && typeof value.path === 'string';
}

function isTags(value: unknown): value is GoldenTags {
  return isObject(value) && typeof value.op === 'string';
}
