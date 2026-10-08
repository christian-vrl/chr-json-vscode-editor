// CI coverage guard (001 T10, spec 001 criterion 1): run first in .github/workflows/ci.yml.
//
// 1. Every standard script named in AGENTS.md §Canonical stack exists in the root package.json.
// 2. ci.yml runs each of them as `pnpm <name>`.
// 3. The scripts that are still placeholders (they call scripts/not-yet.mjs and exit 0 without
//    checking anything) are exactly the ones passed with --placeholder. A placeholder's green step
//    is not coverage, so CI names each one in its job summary; when the owning task makes a script
//    real, this check fails until ci.yml stops listing it, and a real script can't silently turn
//    back into a placeholder.
//
//   node scripts/check-ci.mjs [--placeholder <name>]... [--root <dir>]
//
// --root  the repository to check (default: this one); tests point it at a temporary copy.
// Exit codes: 0 ok · 1 a rule above is broken · 2 bad arguments.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

let args;
try {
  args = parseArgs({
    options: {
      placeholder: { type: 'string', multiple: true, default: [] },
      root: { type: 'string' },
    },
  }).values;
} catch (error) {
  console.error(`check-ci: ${error.message}`);
  process.exit(2);
}

const root = path.resolve(
  args.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const agents = read('AGENTS.md');
const section = agents.match(/\*\*Standard scripts[^*]*\*\*([\s\S]*?)\n\n/);
if (!section) {
  console.error('check-ci: AGENTS.md has no **Standard scripts** paragraph');
  process.exit(1);
}
const standard = [...section[1].matchAll(/`pnpm ([\w:-]+)`/g)].map((m) => m[1]);

const scripts = JSON.parse(read('package.json')).scripts ?? {};
// Comments (YAML, and shell comments inside `run:` blocks) don't run anything, so they don't count.
const workflow = read('.github/workflows/ci.yml').replace(/(^|\s)#.*$/gm, '$1');

const problems = [];
for (const name of standard) {
  if (!(name in scripts)) problems.push(`standard script \`${name}\` is missing from package.json`);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\bpnpm ${escaped}(?![\\w:-])`).test(workflow)) {
    problems.push(`ci.yml does not run \`pnpm ${name}\``);
  }
}

const actual = Object.keys(scripts).filter((name) =>
  /\bscripts\/not-yet\.mjs\b/.test(scripts[name]),
);
const expected = args.placeholder;
for (const name of actual.filter((n) => !expected.includes(n))) {
  problems.push(`\`${name}\` is a placeholder (scripts/not-yet.mjs) but CI counts it as a check`);
}
for (const name of expected.filter((n) => !actual.includes(n))) {
  problems.push(
    `\`${name}\` is listed as a placeholder but runs a real check; drop it from ci.yml`,
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-ci: ${problem}`);
  process.exit(1);
}

const summary = [
  `check-ci: ok, ${standard.length} standard scripts, all run by ci.yml`,
  actual.length === 0
    ? 'check-ci: no placeholders'
    : `check-ci: placeholders, green but not coverage: ${actual.join(', ')}`,
];
for (const line of summary) console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = actual.map(
    (n) => `- \`pnpm ${n}\` is a placeholder: its green step checks nothing.`,
  );
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Standard scripts\n\n${standard.length} standard scripts run in CI.\n\n${lines.join('\n')}\n`,
  );
}
