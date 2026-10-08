// pnpm check:licenses (001 T7, AGENTS.md rule 4, spec 001 criterion 3).
//
// Walks the production dependency graph (`dependencies`, `optionalDependencies`, and installed
// `peerDependencies`; never `devDependencies`) of each shipped package, resolving every name the
// way Node does (node_modules/ in the depender's real directory, then each parent), and requires
// each package's SPDX `license` to evaluate to allowed. Dev tooling is not shipped, so it is not
// checked: the transitive dev dependency minimatch (BlueOak-1.0.0) does not fail the check.
//
//   node scripts/check-licenses.mjs [--package <dir>]... [--notice <file>]
//
// --package  a shipped package directory (repeatable); defaults to the packages that ship to users.
// --notice   on success, write THIRD_PARTY_LICENSES.md for those packages: every third-party
//            dependency with its license text. Dependencies declared `workspace:` are first-party.
// Exit codes: 0 all allowed · 1 a dependency is not allowed or not installed · 2 bad arguments.
//
// Expected-failure fixture: `--package tests/fixtures/bad-license` exits 1 (see tests/fixtures/).
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evaluateLicense, readAllowlist } from './licenses/spdx.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The workspace packages whose builds reach users (the .vsix; the Chrome app later, spec 020). */
const SHIPPED_PACKAGES = ['packages/vscode-extension', 'packages/chrome-app'];

/** @param {string} dir */
function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

/**
 * The manifest's license as one SPDX expression. The deprecated `licenses` array and
 * `{ type }` objects are joined with AND, the cautious reading.
 */
function licenseOf(manifest) {
  const asText = (entry) => (typeof entry === 'string' ? entry : entry?.type);
  if (manifest.license !== undefined) return asText(manifest.license);
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses.map((entry) => `(${asText(entry)})`).join(' AND ');
  }
  return undefined;
}

/** Node-style lookup of `name` from `fromDir`; returns the real directory or undefined. */
function resolvePackage(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      try {
        return realpathSync(path.join(dir, 'node_modules', name));
      } catch {
        // not here; keep walking up
      }
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * @param {string[]} packageDirs
 * @returns {{ packages: Map<string, object>, problems: string[] }}
 */
function walk(packageDirs) {
  /** real dir -> { name, version, license, dir, firstParty, via } */
  const packages = new Map();
  const problems = [];
  const queue = packageDirs.map((dir) => ({ dir: realpathSync(dir), firstParty: true, via: [] }));
  while (queue.length > 0) {
    const { dir, firstParty, via } = queue.shift();
    if (packages.has(dir)) continue;
    const manifest = readManifest(dir);
    const name = manifest.name ?? path.basename(dir);
    const chain = [...via, name];
    packages.set(dir, {
      name,
      version: manifest.version,
      license: licenseOf(manifest),
      dir,
      firstParty,
      via: chain,
    });
    const optional = new Set([
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.entries(manifest.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional)
        .map(([dep]) => dep),
    ]);
    const deps = {
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
      ...manifest.dependencies,
    };
    for (const [dep, spec] of Object.entries(deps)) {
      const peerOnly =
        !(dep in (manifest.dependencies ?? {})) && !(dep in (manifest.optionalDependencies ?? {}));
      const resolved = resolvePackage(dep, dir);
      if (resolved === undefined) {
        // A missing optional dependency is not installed on this platform, so it is not shipped
        // from here; a peer is provided by whoever depends on this package.
        if (!optional.has(dep) && !peerOnly) {
          problems.push(
            `${dep} (needed by ${chain.join(' > ')}) is not installed; run pnpm install`,
          );
        }
        continue;
      }
      queue.push({
        dir: resolved,
        firstParty: firstParty && String(spec).startsWith('workspace:'),
        via: chain,
      });
    }
  }
  return { packages, problems };
}

/** First file in `dir` named LICENSE*, LICENCE* or COPYING*, if any. */
function licenseText(dir) {
  const file = readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)(\b|[.-])/i.test(f))
    .sort()[0];
  return file === undefined ? undefined : readFileSync(path.join(dir, file), 'utf8').trim();
}

function renderNotice(thirdParty) {
  const lines = [
    '# Third-party licenses',
    '',
    'Generated by `scripts/check-licenses.mjs` (001 T7) from the production dependencies this package ships.',
    '',
  ];
  if (thirdParty.length === 0) lines.push('This package ships no third-party dependencies.', '');
  for (const dep of thirdParty) {
    lines.push(`## ${dep.name}@${dep.version}`, '', `License: ${dep.license}`, '');
    const text = licenseText(dep.dir);
    lines.push(
      ...(text === undefined
        ? ['(The package includes no license file.)']
        : ['~~~~text', text, '~~~~']),
      '',
    );
  }
  return lines.join('\n');
}

let args;
try {
  args = parseArgs({
    options: { package: { type: 'string', multiple: true }, notice: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  }).values;
} catch (error) {
  console.error(`check:licenses: ${error.message}`);
  process.exit(2);
}

const packageDirs = (args.package ?? SHIPPED_PACKAGES.map((p) => path.join(repo, p))).map((p) =>
  path.resolve(p),
);
const allowed = readAllowlist(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'));
const { packages, problems } = walk(packageDirs);

for (const dep of packages.values()) {
  const verdict = evaluateLicense(dep.license, allowed);
  if (!verdict.allowed) {
    problems.push(
      `${dep.name}@${dep.version} license ${JSON.stringify(dep.license ?? null)}: ${verdict.reason} (via ${dep.via.join(' > ')})`,
    );
  }
}

if (problems.length > 0) {
  console.error(`check:licenses: FAILED. Allowed (AGENTS.md rule 4): ${allowed.join(', ')}`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const thirdParty = [...packages.values()]
  .filter((dep) => !dep.firstParty)
  .sort(
    (a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)),
  );
if (args.notice) writeFileSync(args.notice, renderNotice(thirdParty));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(
  `check:licenses: ok, all ${thirdParty.length} third-party production dependencies of ` +
    `${plural(packageDirs.length, 'shipped package')} allowed` +
    (args.notice ? `; wrote ${path.relative(process.cwd(), args.notice) || args.notice}` : ''),
);
