// The bench texts of spike 015 T1: bench/generate.mjs's JSON document (the one criterion 11's
// 2x bound is about, padding and all) and the same records with 19-digit ids, each exactly
// 5 and 50 MiB, ASCII only. Deterministic.
import { createHash } from 'node:crypto';
import { isSafeNumber } from 'lossless-json';
import { MIB, documentText } from '../../bench/generate.mjs';

export const SIZES_MIB = [5, 50];

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
/** 2^60: every id from here on has 19 digits and is past 2^53, so each is a big number. */
const FIRST_ID = 1152921504606846976n;

/** bench/generate.mjs's record with a 19-digit id, written as JSON text (BigInt digits). */
function bigIdElement(i, note = null) {
  const word = WORDS[i % WORDS.length];
  const record = {
    id: '\u0000ID\u0000',
    name: `${word}-${i}`,
    active: i % 3 !== 0,
    score: Math.round(((i * 7919) % 100000) / 7) / 100,
    tags: [word, WORDS[(i + 3) % WORDS.length]],
    address: { street: `${i % 999} ${word} street`, zip: String(10000 + (i % 89999)) },
    note,
  };
  const id = (FIRST_ID + BigInt(i) * 7919n).toString();
  const text = JSON.stringify(record, null, 2).replace('"\\u0000ID\\u0000"', id);
  return '  ' + text.split('\n').join('\n  ');
}

/** `[\n<records>\n]\n` of exactly `bytes` bytes, padded inside the last record's note (a string
 *  of 'x', so the padding is no run of dots). Returns the text and its record count. */
export function bigIdText(bytes) {
  const parts = [];
  let length = '[\n'.length + '\n]\n'.length;
  for (let i = 0; ; i++) {
    const next = bigIdElement(i);
    const added = (parts.length ? 2 : 0) + next.length;
    if (length + added + bigIdElement(i + 1, '').length + 2 > bytes) break;
    parts.push(next);
    length += added;
  }
  const base = bigIdElement(parts.length, '').length + (parts.length ? 2 : 0);
  const pad = bytes - length - base;
  if (pad < 0) throw new Error(`size ${bytes} is too small`);
  parts.push(bigIdElement(parts.length, 'x'.repeat(pad)));
  const text = `[\n${parts.join(',\n')}\n]\n`;
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  let big = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!isSafeNumber((FIRST_ID + BigInt(i) * 7919n).toString())) big++;
  }
  return { text, records: parts.length, bigNumbers: big };
}

/** Every bench text: id, bytes, big numbers it holds, sha256, text. */
export function benchTexts() {
  const out = [];
  for (const mib of SIZES_MIB) {
    const plain = documentText(mib * MIB);
    out.push({ id: `plain-${mib}mib`, bigNumbers: 0, text: plain });
    const big = bigIdText(mib * MIB);
    out.push({
      id: `big-id-${mib}mib`,
      bigNumbers: big.bigNumbers,
      records: big.records,
      text: big.text,
    });
  }
  return out.map((t) => ({
    ...t,
    bytes: t.text.length,
    sha256: createHash('sha256').update(t.text).digest('hex'),
  }));
}
