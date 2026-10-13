// CSV field names (spec 009 §Terms): where a cell's value sits in a row object, in csv42's notation.
// A member of a nested object appends `.` and its key (`address.city`), an array item `[<index>]`
// (`tags[0]`); a key that is empty or holds `.`, `[`, `]` or `"` is written `["<key>"]`, its key as a
// JSON string, with no `.` before it (`["a.b"]`, `address[""]`).

/** One step of a field name's path: an object key or an array index. */
export type Segment = string | number;

const NOT_PLAIN = /[.[\]"]/;

/** Whether `key` can be written as is (a plain key): non-empty, with none of `.`, `[`, `]`, `"`. */
function isPlainKey(key: string): boolean {
  return key !== '' && !NOT_PLAIN.test(key);
}

/** The field name of the member `key` of the value named `parent` (`''` for the row itself). */
export function memberName(parent: string, key: string): string {
  if (!isPlainKey(key)) return `${parent}[${JSON.stringify(key)}]`;
  return parent === '' ? key : `${parent}.${key}`;
}

/** The field name of item `index` of the array named `parent`. */
export function itemName(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

const INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * The path a field name spells in §Terms notation, or `undefined` when it is not notation
 * (tests/golden/README.md, CSV reading 5): a first key, plain or `["…"]`, then any of `.key`,
 * `[n]` (decimal, no leading zero) and `["…"]`.
 */
export function parseFieldName(name: string): Segment[] | undefined {
  const path: Segment[] = [];
  let i = 0;
  const plainAt = (start: number): number => {
    let end = start;
    while (end < name.length && !NOT_PLAIN.test(name[end]!)) end++;
    return end;
  };
  while (i < name.length) {
    const ch = name[i];
    if (ch === '[') {
      if (name[i + 1] === '"') {
        const end = jsonStringEnd(name, i + 1);
        if (end === undefined || name[end] !== ']') return undefined;
        let key: unknown;
        try {
          key = JSON.parse(name.slice(i + 1, end));
        } catch {
          return undefined;
        }
        path.push(key as string);
        i = end + 1;
      } else {
        // An index never starts a name: `[0]` alone is a flat key.
        if (path.length === 0) return undefined;
        const end = name.indexOf(']', i);
        if (end < 0) return undefined;
        const digits = name.slice(i + 1, end);
        if (!INDEX.test(digits)) return undefined;
        // Any digit run is an index here, however large (`Infinity` past double range): csvToJson
        // keeps a name with an index above its cap as a flat key, with a warning (I5, UNK-063).
        path.push(Number(digits));
        i = end + 1;
      }
    } else if (ch === '.') {
      if (path.length === 0) return undefined;
      const end = plainAt(i + 1);
      if (end === i + 1) return undefined;
      path.push(name.slice(i + 1, end));
      i = end;
    } else {
      if (path.length > 0) return undefined;
      const end = plainAt(i);
      if (end === i) return undefined;
      path.push(name.slice(i, end));
      i = end;
    }
  }
  return path.length > 0 ? path : undefined;
}

/** The index just past the closing quote of the JSON string starting at `start`, if it closes. */
function jsonStringEnd(text: string, start: number): number | undefined {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '"') return i + 1;
  }
  return undefined;
}
