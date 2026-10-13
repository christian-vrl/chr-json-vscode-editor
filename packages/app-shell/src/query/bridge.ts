// The page's half of the value bridge (spec 011 Q2, plan steps 2 and 4). Data crosses into and out
// of the engine as JSON text plus a list of the numbers JSON text can't hold (`-0`, `NaN`,
// `Infinity`, `-Infinity`), each with the path of keys where it sits; the text holds `null` there
// (`0` for `-0`, as `JSON.stringify` writes it).
// The engine's half is ENGINE_HELPERS in engine-source.ts, which uses the same list format.

/** A number JSON text can't hold, by name. */
export type SpecialCode = 'NaN' | 'Infinity' | '-Infinity' | '-0';

/** Where a special number sits (keys from the root; array indexes as strings) and which it is. */
export type Special = [path: string[], code: SpecialCode];

export interface Encoded {
  /** JSON text with `null` (or `0`, for `-0`) where each special number sits. */
  text: string;
  /** JSON text of the `Special[]` list; `[]` in the usual case. */
  specials: string;
}

export function specialCode(value: number): SpecialCode | undefined {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return undefined;
}

const specialValues: Readonly<Record<SpecialCode, number>> = {
  NaN: NaN,
  Infinity: Infinity,
  '-Infinity': -Infinity,
  '-0': -0,
};

/**
 * The data the query gets, as the engine reads it (Q1, Q2). The editor's data is plain JSON values
 * (core's parsers give no functions, dates or cycles), so the specials are found with one walk and
 * the text is a plain `JSON.stringify`, which keeps key order and writes a `__proto__` own key.
 */
export function encodeData(data: unknown): Encoded {
  const specials: Special[] = [];
  const path: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'number') {
      const code = specialCode(value);
      if (code) specials.push([[...path], code]);
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        path.push(String(i));
        walk(value[i]);
        path.pop();
      }
    } else if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        path.push(key);
        walk((value as Record<string, unknown>)[key]);
        path.pop();
      }
    }
  };
  walk(data);
  return { text: JSON.stringify(data) ?? 'null', specials: JSON.stringify(specials) };
}

/**
 * The result in the page: the engine's JSON text parsed (`JSON.parse` makes a `__proto__` key an
 * own key, as core's parsers do) and each special number put back at its path.
 */
export function decodeResult(text: string, specials: string): unknown {
  let root: unknown = JSON.parse(text);
  for (const [path, code] of JSON.parse(specials) as Special[]) {
    root = setAt(root, path, specialValues[code]);
  }
  return root;
}

/** Sets the value at `path` (which the text already holds as `null`); returns the new root. */
function setAt(root: unknown, path: readonly string[], value: number): unknown {
  if (path.length === 0) return value;
  let holder = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) holder = holder[path[i]!] as Record<string, unknown>;
  // defineProperty, not assignment: the key may be `__proto__`, which is an own data key here.
  Object.defineProperty(holder, path[path.length - 1]!, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return root;
}
