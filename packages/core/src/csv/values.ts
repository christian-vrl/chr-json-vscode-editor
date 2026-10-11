// Cell text to JSON values (spec 009 I7, UNK-043 ★ "Exact"), shared with export's quoting (X6).

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** An unquoted cell that I7 reads as a number: RFC 8259 syntax and written back unchanged. */
function asNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined;
  const value = Number(text);
  return JSON.stringify(value) === text ? value : undefined;
}

/** Whether I7 reads the unquoted cell `text` as a number, `true`, `false` or `null`. */
export function readsAsScalar(text: string): boolean {
  return text === 'true' || text === 'false' || text === 'null' || asNumber(text) !== undefined;
}

/**
 * The object or array whose JSON text `text` is, or `undefined`. The text must start with `{` or
 * `[` and end with `}` or `]` (CSV reading 9): `" [1]"` and `"[1] "` stay strings.
 */
function asContainer(text: string): object | undefined {
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  // `{` `[` and `}` `]`.
  if ((first !== 0x7b && first !== 0x5b) || (last !== 0x7d && last !== 0x5d)) return undefined;
  try {
    return JSON.parse(text) as object;
  } catch {
    return undefined;
  }
}

/** I7: the value of a cell. */
export function cellValue(text: string, wasQuoted: boolean): unknown {
  if (wasQuoted) return asContainer(text) ?? text;
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  const first = text.charCodeAt(0);
  if (first === 0x2d || (first >= 0x30 && first <= 0x39)) {
    const number = asNumber(text);
    if (number !== undefined) return number;
  }
  return asContainer(text) ?? text;
}
