// JSON5-only syntax for property tests (moved from 006 T2's convert suite, shared with 010 T2's
// smart-format suite): rewrites some tokens of a JSON5 text in JSON5-only forms of the same data.
import fc from 'fast-check';
import { parseJson5 } from '../src/formats/json5-parser.js';
import { Kind, type Token } from '../src/formats/tokens.js';

type Gen = fc.GeneratorValue;

const JSON5_SPACES = [' ', '\v', '\f', '﻿', ' ', '　'];

const slice = (text: string, t: Token) => text.slice(t.offset, t.end);

export function pick<T>(g: Gen, items: readonly T[]): T {
  return items[g(fc.integer, { min: 0, max: items.length - 1 })]!;
}

/** A single-quoted JSON5 string for `value`, with `\x` escapes for control characters. */
function singleQuoted(value: string): string {
  let out = "'";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === "'" || ch === '\\') out += `\\${ch}`;
    else if (code < 0x20) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}'`;
}

/** `text` (JSON5) with some tokens rewritten in JSON5-only forms of the same data. */
export function json5Only(text: string, g: Gen): string {
  const tokens = parseJson5(text).tokens;
  let out = '';
  let at = 0;
  for (const t of tokens) {
    const src = slice(text, t);
    let next = src;
    const roll = g(fc.integer, { min: 1, max: 6 });
    if (t.kind === Kind.NumericLiteral && /^-?(?:0|[1-9]\d*)$/.test(src)) {
      const n = BigInt(src);
      const abs = n < 0n ? -n : n;
      if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) {
        const sign = src[0] === '-' ? '-' : '';
        if (roll === 1) next = `${sign}0x${abs.toString(16)}`;
        else if (roll === 2) next = `${sign}0X${abs.toString(16).toUpperCase()}`;
        else if (roll === 3 && sign === '') next = `+${src}`;
        else if (roll === 4) next = `${src}.`;
      }
    } else if (t.kind === Kind.NumericLiteral && /^-?0\.\d/.test(src) && roll <= 2) {
      next = src.replace('0.', '.');
    } else if (t.kind === Kind.StringLiteral && roll <= 2) {
      next = singleQuoted(parseJson5(src).data as string);
    } else if (t.kind === Kind.Whitespace && roll <= 2) {
      const i = g(fc.integer, { min: 0, max: src.length - 1 });
      next = src.slice(0, i) + pick(g, JSON5_SPACES) + src.slice(i + 1);
    } else if (t.kind === Kind.Whitespace && roll === 3 && /^[ \t]*$/.test(src)) {
      next = src + pick(g, JSON5_SPACES);
    } else if (t.kind === Kind.LineBreak && roll === 1) {
      next = pick(g, [' ', ' ']);
    }
    out += text.slice(at, t.offset) + next;
    at = t.end;
  }
  return out + text.slice(at);
}
