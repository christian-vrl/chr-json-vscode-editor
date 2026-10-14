// Copy path and reveal node in the page (spec 018 S1–S4, 018 T2): what the editor library selects,
// as core's paths (P1–P4). The library names every step with a string (`JSONPath` from
// immutable-json-patch is `string[]`), so `"0"` the name and `0` the index read the same; these
// functions tell them apart by what the library shows (plan 018 risk R2): its data when it holds
// some, else its text, where core's `placeOf` says whether a step is an array index (a step that
// looks like an index is one exactly when the node it names is in the text). Neither way builds a
// tree from the text or adds to core's parse cache (spec 018 criterion 11).
import { placeOf, readPath, type Format, type PathStep } from '@chr-json-editor/core';

/** What the library shows: its data, or the text it reads with the format's parser. */
export type PathView = { json: unknown } | { text: string; format: Format };

/** A path as the library writes it: one string per step. */
export type LibraryPath = readonly string[];

/** The selection shapes S1 reads (vanilla-jsoneditor's `JSONEditorSelection`, by `type`). */
export type LibrarySelection =
  | { type: 'multi'; anchorPath: LibraryPath; focusPath: LibraryPath }
  | { type: 'after' | 'inside' | 'key' | 'value'; path: LibraryPath }
  | { type: 'text' };

/** S1's message for a selection of several nodes. */
export const SEVERAL_NODES = 'Select one node to copy its path.';

/** The library's own message for a path not in the data (its NavigationBarPathEditor). */
export const NOT_IN_DOCUMENT = 'Path does not exist in current document';

const INDEX = /^(?:0|[1-9][0-9]*)$/;

/**
 * An error the navigation bar's edit box shows as it is. The library shows `String(error)`, so the
 * text reads without the "Error: " prefix.
 */
export class PathTextError extends Error {
  override toString(): string {
    return this.message;
  }
}

/**
 * S1: the library path of the node a tree or table selection names. A key, value or edit selection
 * names its node, an "inside" caret its container, an "after" caret the node before it; a
 * multi-selection of one node that node, of several none (`'several'`); no selection the root.
 * Undefined for a text selection, which names an offset (`nodeAt`).
 */
export function selectedPath(
  selection: LibrarySelection | undefined,
): LibraryPath | 'several' | undefined {
  if (!selection) return [];
  switch (selection.type) {
    case 'text':
      return undefined;
    case 'multi':
      return samePath(selection.anchorPath, selection.focusPath) ? selection.anchorPath : 'several';
    default:
      return selection.path;
  }
}

function samePath(a: LibraryPath, b: LibraryPath): boolean {
  return a.length === b.length && a.every((step, i) => step === b[i]);
}

/** Core's path for a library path: a step into an array is an index, any other step a name. A step
 *  past the shown data or text keeps its string as a name. */
export function stepsOf(view: PathView, path: LibraryPath): PathStep[] {
  if ('json' in view) {
    const steps: PathStep[] = [];
    let value: unknown = view.json;
    for (const step of path) {
      if (Array.isArray(value) && INDEX.test(step)) {
        steps.push(Number(step));
        value = value[Number(step)];
      } else {
        steps.push(step);
        value = isObject(value) && Object.hasOwn(value, step) ? value[step] : undefined;
      }
    }
    return steps;
  }
  const steps: PathStep[] = [];
  for (const step of path) {
    const index =
      INDEX.test(step) && placeOf(view.format, view.text, [...steps, Number(step)]) !== undefined;
    steps.push(index ? Number(step) : step);
  }
  return steps;
}

/** Whether the node of `path` is in what the library shows. */
export function hasNode(view: PathView, path: readonly PathStep[]): boolean {
  if (!('json' in view)) return placeOf(view.format, view.text, path) !== undefined;
  let value: unknown = view.json;
  for (const step of path) {
    if (typeof step === 'number') {
      if (!Array.isArray(value) || step >= value.length) return false;
      value = value[step];
    } else {
      if (!isObject(value) || !Object.hasOwn(value, step)) return false;
      value = value[step];
    }
  }
  return true;
}

/**
 * S3: the library path the navigation bar's edit box names: a JSONPath or JSON Pointer read as P3
 * reads it (a pointer's steps against what the library shows), of a node it shows. Throws a
 * PathTextError with P3's refusal, or the library's own message for a path not in the data.
 * `shown` turns a path as the text names it into the library's (JSON Lines items past a bad line,
 * UNK-090).
 */
export function readNavigationPath(
  view: PathView,
  text: string,
  shown: (path: PathStep[]) => PathStep[] = (path) => path,
): string[] {
  const pointer = /^[ \t\r\n]*\//.test(text);
  const read = readPath(text, 'json' in view ? view.json : undefined);
  if ('error' in read) throw new PathTextError(read.error);
  // Against the text, a pointer's steps come back as names: those into arrays are indices.
  const steps = pointer && !('json' in view) ? stepsOf(view, read.path.map(String)) : read.path;
  // The text counts items as the path does; the data counts them as the library does.
  if (!hasNode(view, 'json' in view ? shown(steps) : steps))
    throw new PathTextError(NOT_IN_DOCUMENT);
  return shown(steps).map(String);
}

/** The library path of core's path. */
export function libraryPath(path: readonly PathStep[]): string[] {
  return path.map(String);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
