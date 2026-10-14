// Big numbers through the library's query languages (spec 015 B7, 015 T5): JSONQuery, JMESPath,
// JSONPath (Goessner) and JSONPath (RFC 9535) run on a copy of their input in which each big number
// is its nearest number, as before; numbers in the result are then put back as the big numbers they
// came from, where that is certain. JSONQuery and JMESPath already read a rounded copy (the library
// runs them on `JSON.parse(parser.stringify(json))`); JSONPath (Goessner) and RFC 9535 would run on
// the editor's own data, so the copy is made here for every language.
//
// A result number is the nearest number of some numbers of the input. When those are one big number
// (by exact value, spec 015 §Terms) and no plain number, it is that big number again; when they are
// plain numbers only, it stays as it is; when they are two or more different exact values, it can't
// be told which one it was, and the query fails with AMBIGUOUS's message, so the Transform dialog
// shows it in the preview and disables Transform (the library's TransformModal does both for a
// query that throws). A number no input number rounds to was computed, and stays as JavaScript
// writes it.
import {
  bigNumberKey,
  holdsBigNumber,
  LosslessNumber,
  nearestNumbers,
} from '@chr-json-editor/core';
import type { QueryLanguage } from 'vanilla-jsoneditor';

/** B7's message for `count` result numbers that can't be kept exact. */
export function ambiguousMessage(count: number): string {
  return count === 1
    ? "1 number in this result can't be kept exact."
    : `${count} numbers in this result can't be kept exact.`;
}

/** What rounds to one nearest number: the exact values (as `bigNumberKey` and plain numbers key
 *  them), and the digits of the input's first big number (in document order) that rounds to it. */
interface Origin {
  keys: Set<string>;
  big: string;
  /** A plain number of the input has this value. */
  plain: boolean;
}

/** Each nearest number of the input's big numbers, with what rounds to it; undefined when the
 *  input holds no big number. */
export function bigNumberOrigins(data: unknown): Map<number, Origin> | undefined {
  if (!holdsBigNumber(data)) return undefined;
  const origins = new Map<number, Origin>();
  forEachNumber(data, (n) => {
    if (!(n instanceof LosslessNumber)) return;
    const nearest = Number(n.value);
    let origin = origins.get(nearest);
    if (!origin) origins.set(nearest, (origin = { keys: new Set(), big: n.value, plain: false }));
    origin.keys.add(bigNumberKey(n));
  });
  forEachNumber(data, (n) => {
    if (typeof n !== 'number') return;
    const origin = origins.get(n);
    if (!origin) return;
    origin.plain = true;
    origin.keys.add(`d${n}`);
  });
  return origins;
}

/** Calls `visit` with every number (plain or big) in `data`, in document order, without
 *  recursion. */
function forEachNumber(data: unknown, visit: (n: number | LosslessNumber) => void): void {
  const stack: unknown[] = [data];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === 'number' || value instanceof LosslessNumber) visit(value);
    else if (value !== null && typeof value === 'object') {
      const members: unknown[] = Array.isArray(value) ? value : Object.values(value);
      for (let i = members.length - 1; i >= 0; i--) stack.push(members[i]);
    }
  }
}

/**
 * `result` with each number that came from exactly one big number of the input put back as that big
 * number (B7), made by `big` from its digits. A new one, not the input's: the Transform dialog hands
 * the language a read-only proxy of the editor's data (vanilla-jsoneditor 3.13.0 TransformModal
 * `readonlyProxy`), which must not end up in the document. Containers that change are copied (a
 * `__proto__` key stays a member); the others are returned as they are. Throws AMBIGUOUS's message
 * when a result number rounds from two or more different exact values of the input.
 */
export function restoreBigNumbers(
  result: unknown,
  origins: Map<number, Origin>,
  big: (decimal: string) => unknown = (decimal) => new LosslessNumber(decimal),
): unknown {
  let ambiguous = 0;
  const copies = new Map<object, unknown>();
  const restore = (value: unknown): unknown => {
    if (typeof value === 'number') {
      const origin = origins.get(value);
      if (!origin) return value;
      if (origin.keys.size > 1) {
        ambiguous++;
        return value;
      }
      return origin.plain ? value : big(origin.big);
    }
    if (value === null || typeof value !== 'object' || value instanceof LosslessNumber)
      return value;
    // The same container reached twice (a JSONPath result lists a node and its parent) is restored
    // once, and stays shared.
    if (copies.has(value)) return copies.get(value);
    copies.set(value, value);
    let copy: unknown[] | Record<string, unknown> | undefined;
    if (Array.isArray(value)) {
      let items: unknown[] | undefined;
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i];
        const restored = restore(item);
        if (restored !== item) (items ??= value.slice())[i] = restored;
      }
      copy = items;
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const member = record[key];
        const restored = restore(member);
        if (restored === member) continue;
        copy ??= copyOf(record);
        Object.defineProperty(copy, key, {
          value: restored,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
    if (copy) copies.set(value, copy);
    return copy ?? value;
  };
  const restored = restore(result);
  if (ambiguous > 0) throw new Error(ambiguousMessage(ambiguous));
  return restored;
}

/** A plain copy of `record`, every member defined as data (so a `__proto__` key stays a member). */
function copyOf(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(record))
    Object.defineProperty(copy, key, {
      value: record[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return copy;
}

/** `language` with B7's rule around its `executeQuery`, restored big numbers made by `big` (the
 *  page passes its `editorNumber`); on data with no big number it runs exactly as the library's
 *  own. */
export function exactNumbersLanguage(
  language: QueryLanguage,
  big?: (decimal: string) => unknown,
): QueryLanguage {
  return {
    ...language,
    executeQuery: (json, query, parser) => {
      const origins = bigNumberOrigins(json);
      if (!origins) return language.executeQuery(json, query, parser);
      const result = language.executeQuery(nearestNumbers(json), query, parser);
      return restoreBigNumbers(result, origins, big);
    },
  };
}
