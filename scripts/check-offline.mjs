// pnpm check:offline (001 T8, AGENTS.md rule 3, spec 001 criterion 3).
//
// Scans build output for `http://` and `https://` URLs (any case) and fails on each one not listed in
// offline-allowlist.txt. Shipped code has no reason to name a remote URL except text nobody fetches
// (license headers, schema `$id`s), and those are allowlisted one by one. The runtime half of the
// guard is `pnpm test:web`, whose fixture fails any test that requests another origin.
//
//   node scripts/check-offline.mjs [--dist <dir>]... [--allowlist <file>]
//
// --dist       a directory to scan recursively (repeatable); defaults to every packages/*/dist,
//              so run `pnpm build` first.
// --allowlist  defaults to offline-allowlist.txt at the repo root.
// Exit codes: 0 no unlisted URL · 1 an unlisted URL was found · 2 bad arguments or nothing to scan
// (so an unbuilt checkout never passes).
//
// Expected-failure fixture: `--dist tests/fixtures/offline-fetch/web` exits 1 (see tests/fixtures/).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A URL runs until whitespace, a quote, a bracket or a backslash (an escape inside a JS string). */
const URL_PATTERN = /https?:\/\/[^\s"'`<>()[\]{}\\]+/gi;

/** Sentence punctuation right after a URL in prose is not part of it. */
function trimUrl(url) {
  return url.replace(/[.,;:!?]+$/, '');
}

/** @param {string} file */
function readAllowlist(file) {
  return new Set(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      // `#` starts a comment at the start of a line or after a space, so a URL may keep its
      // fragment (a JSON Schema `$id` such as `http://json-schema.org/draft-07/schema#`, 004 T2).
      .map((line) => line.replace(/(^|\s)#.*/, '').trim())
      .filter(Boolean),
  );
}

/** @param {string} dir @returns {string[]} every file under `dir` */
function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function defaultDists() {
  const packages = path.join(repo, 'packages');
  return readdirSync(packages)
    .map((name) => path.join(packages, name, 'dist'))
    .filter((dir) => existsSync(dir));
}

let args;
try {
  args = parseArgs({
    options: {
      dist: { type: 'string', multiple: true },
      allowlist: { type: 'string', default: path.join(repo, 'offline-allowlist.txt') },
    },
  }).values;
} catch (error) {
  console.error(`check:offline: ${error.message}`);
  process.exit(2);
}

const dists = (args.dist ?? defaultDists()).map((dir) => path.resolve(dir));
const allowlist = readAllowlist(args.allowlist);
const files = [];
for (const dir of dists) {
  if (!existsSync(dir)) {
    console.error(
      `check:offline: ${path.relative(repo, dir)} does not exist; run pnpm build first`,
    );
    process.exit(2);
  }
  files.push(...filesUnder(dir));
}
if (files.length === 0) {
  console.error('check:offline: no build output to scan; run pnpm build first');
  process.exit(2);
}

const found = [];
const used = new Set();
for (const file of files) {
  // latin1 maps every byte to one character, so binary files cannot throw and URLs stay ASCII.
  const lines = readFileSync(file, 'latin1').split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(URL_PATTERN)) {
      const url = trimUrl(match[0]);
      if (allowlist.has(url)) used.add(url);
      else found.push(`${path.relative(repo, file)}:${index + 1}: ${url}`);
    }
  });
}

for (const url of allowlist) {
  if (!used.has(url))
    console.warn(`check:offline: warning: allowlist entry not found in output: ${url}`);
}
if (found.length > 0) {
  console.error('check:offline: FAILED. URLs in build output not in offline-allowlist.txt:');
  for (const entry of found) console.error(`  - ${entry}`);
  process.exit(1);
}
console.log(
  `check:offline: ok (${files.length} files in ${dists.length} dist directories, ${used.size} allowlisted URLs)`,
);
