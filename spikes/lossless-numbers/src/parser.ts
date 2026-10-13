// The webview parser candidates spike 015 T1 measures (plan 015 R1) and the parser the library
// probes use (plan R2). Nothing here ships; T4 writes app-shell's parser.ts from what REPORT.md says.
import { LosslessNumber, isSafeNumber, parse, stringify } from 'lossless-json';

/** Plan 015 §Approach's pre-scan as written: a run of 16 digits or dots, or an exponent of 3 or
 *  more digits, anywhere in the text. */
export const PLAN_SCAN = /[\d.]{16}|[eE][+-]?\d{3}/;

/** The same test held to number-token shapes: 16 digits with at most a dot between any two (a
 *  number token with 16 or more digits holds such a run), or an exponent of 3 or more digits right
 *  after a digit. Dots alone (`'.....'`) and words (`"charlie-123"`) no longer match. */
export const TOKEN_SCAN = /\d(?:\.?\d){15}|\d[eE][+-]?\d{3}/;

/** TOKEN_SCAN as a char loop. */
export function scanLoop(text: string): boolean {
  let digits = 0;
  let dot = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      if (++digits >= 16) return true;
      continue;
    }
    if (digits > 0) {
      if (c === 46 && !dot) {
        dot = true;
        continue;
      }
      if (c === 101 || c === 69) {
        let j = i + 1;
        const sign = text.charCodeAt(j);
        if (sign === 43 || sign === 45) j++;
        let exponent = 0;
        while (j < n) {
          const d = text.charCodeAt(j);
          if (d < 48 || d > 57) break;
          if (++exponent >= 3) return true;
          j++;
        }
      }
      digits = 0;
      dot = false;
    }
  }
  return false;
}

/** A number token as the spec's B1 reads it: a `LosslessNumber` when `isSafeNumber` is false, else
 *  `Number(text)`. Tokens of at most 15 characters with no exponent are never big (plan §Approach),
 *  so they skip `isSafeNumber`. */
export function parseNumber(text: string): number | LosslessNumber {
  if (
    (text.length > 15 || text.indexOf('e') !== -1 || text.indexOf('E') !== -1) &&
    !isSafeNumber(text)
  ) {
    return new LosslessNumber(text);
  }
  return Number(text);
}

/** lossless-json's `parse` with only big numbers wrapped. */
export function losslessParse(text: string): unknown {
  return parse(text, null, parseNumber);
}

/** lossless-json's `parse` with every number wrapped (the site's parser). */
export function losslessParseAll(text: string): unknown {
  return parse(text);
}

type SourceReviver = (
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
) => unknown;

/** `JSON.parse` with a reviver reading each number's source text (ES2025 JSON.parse source text
 *  access); a big number becomes a `LosslessNumber`. Throws when the engine gives no source. */
export function reviverParse(text: string): unknown {
  const reviver: SourceReviver = (_key, value, context) => {
    if (typeof value !== 'number') return value;
    const source = context?.source;
    if (source === undefined) throw new Error('JSON.parse gives the reviver no source text');
    return parseNumber(source);
  };
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

/** Whether this engine hands `JSON.parse` revivers the source text. */
export function reviverHasSource(): boolean {
  let seen: string | undefined;
  const reviver: SourceReviver = (_key, value, context) => {
    if (typeof value === 'number') seen = context?.source;
    return value;
  };
  JSON.parse('[1.0]', reviver as Parameters<typeof JSON.parse>[1]);
  return seen === '1.0';
}

/** The candidate webview parser for strict JSON: `JSON.parse` when TOKEN_SCAN finds no big-number
 *  candidate, else lossless-json with only big numbers wrapped. `stringify` is lossless-json's. */
export const spikeParser = {
  parse(text: string): unknown {
    return TOKEN_SCAN.test(text) ? losslessParse(text) : (JSON.parse(text) as unknown);
  },
  stringify(
    value: unknown,
    replacer?:
      ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null,
    space?: string | number,
  ): string | undefined {
    return stringify(value, replacer, space);
  },
};

/** A `LosslessNumber` whose `valueOf` never throws: on overflow or underflow it gives the nearest
 *  number (`Infinity`, `-Infinity`, `0`) where lossless-json throws. Still `instanceof
 *  LosslessNumber` with `isLosslessNumber`, so lossless-json's `stringify` writes its digits. */
export class NearestValueNumber extends LosslessNumber {
  override valueOf(): number | bigint {
    try {
      return super.valueOf();
    } catch {
      return Number(this.value);
    }
  }
}

/** `spikeParser` with big numbers read as `NearestValueNumber`. */
export const nearestValueParser = {
  parse(text: string): unknown {
    if (!TOKEN_SCAN.test(text)) return JSON.parse(text) as unknown;
    return parse(text, null, (t) => {
      const n = parseNumber(t);
      return n instanceof LosslessNumber ? new NearestValueNumber(n.value) : n;
    });
  },
  stringify: (
    value: unknown,
    replacer?: Parameters<typeof spikeParser.stringify>[1],
    space?: string | number,
  ) => spikeParser.stringify(value, replacer, space),
};

/** The decimal texts of the big numbers in a strict JSON text, in text order. */
export function bigNumberTexts(text: string): string[] {
  const out: string[] = [];
  const token = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of text.matchAll(token)) {
    const t = match[0];
    if (t.startsWith('"')) continue;
    if (!isSafeNumber(t)) out.push(t);
  }
  return out;
}

export { LosslessNumber, isSafeNumber, stringify as losslessStringify };
