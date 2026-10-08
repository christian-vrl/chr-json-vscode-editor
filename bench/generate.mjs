// Writes the benchmark documents for 003 T11 (UNK-014): one pretty-printed JSON array of records
// per size, exactly <size> MiB (2^20 bytes, the unit VS Code's own file-size limits use), ASCII
// only so bytes equal UTF-16 code units. Deterministic, so every run measures the same bytes.
//
//   node bench/generate.mjs [outDir] [sizes...]   default: bench/.data 1 10 50 100
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SIZES_MIB = [1, 10, 50, 100];
export const MIB = 1024 * 1024;
/** A string that only the last record holds, so a test can tell the whole document was read. */
export const LAST_MARKER = 'chr-bench-last-record';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function record(i) {
  const word = WORDS[i % WORDS.length];
  return {
    id: i,
    name: `${word}-${i}`,
    active: i % 3 !== 0,
    score: Math.round(((i * 7919) % 100000) / 7) / 100,
    tags: [word, WORDS[(i + 3) % WORDS.length]],
    address: { street: `${i % 999} ${word} street`, zip: String(10000 + (i % 89999)) },
    note: null,
  };
}

const INDENT = '  ';

/** One array element as JSON.stringify(record, null, 2) would print it inside the array. */
function element(value) {
  return (
    INDENT +
    JSON.stringify(value, null, 2)
      .split('\n')
      .join('\n' + INDENT)
  );
}

/** The document text of exactly `bytes` bytes: `[\n<records>\n]\n`, padded inside the last note. */
export function documentText(bytes) {
  const parts = [];
  let length = '[\n'.length + '\n]\n'.length;
  for (let i = 0; ; i++) {
    const next = element(record(i));
    const added = (parts.length ? ',\n'.length : 0) + next.length;
    // Leave room for the last record, written below with its padding.
    if (length + added + element(lastRecord(i + 1, 0)).length + 2 > bytes) break;
    parts.push(next);
    length += added;
  }
  const last = lastRecord(parts.length, 0);
  const base = element(last).length + (parts.length ? 2 : 0);
  const pad = bytes - length - base;
  if (pad < 0) throw new Error(`size ${bytes} is too small`);
  parts.push(element(lastRecord(parts.length, pad)));
  const text = `[\n${parts.join(',\n')}\n]\n`;
  if (text.length !== bytes) throw new Error(`wrote ${text.length} bytes, wanted ${bytes}`);
  return text;
}

function lastRecord(i, pad) {
  return { ...record(i), note: LAST_MARKER + '.'.repeat(pad) };
}

export function fileName(mib) {
  return `${mib}mib.json`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outDir = 'bench/.data', ...sizeArgs] = process.argv.slice(2);
  const sizes = sizeArgs.length ? sizeArgs.map(Number) : SIZES_MIB;
  mkdirSync(outDir, { recursive: true });
  for (const mib of sizes) {
    const file = path.join(outDir, fileName(mib));
    writeFileSync(file, documentText(mib * MIB));
    console.log(`bench: wrote ${file} (${mib * MIB} bytes)`);
  }
}
