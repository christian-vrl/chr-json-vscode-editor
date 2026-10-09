// Release workflow guard (005 T2, spec 005 criterion 3): run by ci.yml's release dry run.
//
// .github/workflows/release.yml must
// 1. run only on pushed `v*` tags: `on` is `push` alone, with `tags` as its only filter and every
//    tag pattern starting with `v`;
// 2. read secrets only in jobs that use the GitHub Environment `release`, and no secrets other
//    than VSCE_PAT and OVSX_PAT, both of which it reads;
// 3. pass no secrets on to called workflows (`secrets:` on a job).
// The other half of criterion 3, the owner as the environment's required reviewer, is a repo
// setting: 005 T4's gate checks it with `gh api repos/<owner>/<repo>/environments/release`.
//
//   node scripts/check-release-workflow.mjs [--workflow <file>]
//
// Exit codes: 0 ok · 1 a rule above is broken · 2 bad arguments or unreadable file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const ENVIRONMENT = 'release';
const SECRETS = ['VSCE_PAT', 'OVSX_PAT'];

let args;
let workflow;
try {
  args = parseArgs({ options: { workflow: { type: 'string' } } }).values;
  const file =
    args.workflow ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../.github/workflows/release.yml');
  workflow = parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`check-release-workflow: ${error.message}`);
  process.exit(2);
}

const problems = [];
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
// Every `secrets.NAME` (or `secrets['NAME']`) an expression in this value reads.
const secretsIn = (value) =>
  [
    ...JSON.stringify(value ?? null).matchAll(/secrets\s*(?:\.\s*([\w-]+)|\[\s*'([^']+)'\s*\])/g),
  ].map((m) => m[1] ?? m[2]);

// 1. Triggers.
const on = workflow?.on;
if (!isObject(on) || Object.keys(on).join() !== 'push') {
  problems.push('`on` must be `push` alone (no other trigger)');
} else if (!isObject(on.push) || Object.keys(on.push).join() !== 'tags') {
  problems.push('`on.push` must filter on `tags` alone (no branches or paths)');
} else {
  const tags = [on.push.tags].flat();
  if (tags.length === 0 || !tags.every((tag) => typeof tag === 'string' && tag.startsWith('v'))) {
    problems.push(
      `every \`on.push.tags\` pattern must start with \`v\` (got ${JSON.stringify(tags)})`,
    );
  }
}

// 2–3. Secrets.
const { jobs, ...topLevel } = workflow ?? {};
for (const name of secretsIn(topLevel)) {
  problems.push(
    `secrets.${name} is read outside a job (workflow-level), where no environment applies`,
  );
}
const read = new Set();
for (const [id, job] of Object.entries(isObject(jobs) ? jobs : {})) {
  const environment = isObject(job?.environment) ? job.environment.name : job?.environment;
  const used = secretsIn(job);
  if (job && 'secrets' in job) problems.push(`job \`${id}\` passes secrets to a called workflow`);
  if (used.length > 0 && environment !== ENVIRONMENT) {
    problems.push(`job \`${id}\` reads ${used.join(', ')} without \`environment: ${ENVIRONMENT}\``);
  }
  for (const name of used) {
    if (!SECRETS.includes(name)) problems.push(`job \`${id}\` reads unexpected secret ${name}`);
    read.add(name);
  }
}
for (const name of SECRETS.filter((n) => !read.has(n))) {
  problems.push(`no job in the \`${ENVIRONMENT}\` environment reads secrets.${name}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-release-workflow: ${problem}`);
  process.exit(1);
}
console.log(
  `check-release-workflow: ok, runs only on v* tags; ${SECRETS.join(' and ')} are read only in ` +
    `\`environment: ${ENVIRONMENT}\` jobs (its required reviewer is checked by 005 T4)`,
);
