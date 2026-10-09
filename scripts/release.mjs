// Publish step of the release workflow (005 T2, spec 005 criteria 3–4). release.yml runs it in the
// `release` environment after the owner approves the run; ci.yml's release dry run runs it with
// --dry-run on every PR, so the wiring is exercised long before a tag exists.
//
//   node scripts/release.mjs --tag <vX.Y.Z> [--dry-run] [--root <dir>]
//
// Both modes check that the tag names the extension's version and that the .vsix `pnpm package`
// writes is there, then walk the same three steps:
//   1. Marketplace: vsce publish --packagePath <vsix> --skip-duplicate   (token: VSCE_PAT)
//   2. Open VSX:    ovsx create-namespace <publisher>, only when the namespace doesn't exist yet
//   3. Open VSX:    ovsx publish <vsix> --skip-duplicate                 (token: OVSX_PAT)
// --skip-duplicate lets a re-run finish the second registry after the first one already succeeded.
// Tokens reach the CLIs through the environment variables they read themselves, never argv.
//
// --dry-run  publishes nothing and makes no network request. It refuses to run with either token
//            set, and checks instead that each CLI resolves at its pinned version and accepts every
//            flag the real run passes (from the CLI's own --help).
// --root     the repository to use (default: this one); tests point it at a temporary copy.
// Exit codes: 0 ok · 1 a check or a publish step failed · 2 bad arguments.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const OPEN_VSX = 'https://open-vsx.org';

let args;
try {
  args = parseArgs({
    options: {
      tag: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      root: { type: 'string' },
    },
  }).values;
} catch (error) {
  console.error(`release: ${error.message}`);
  process.exit(2);
}
if (!args.tag) {
  console.error('release: --tag <vX.Y.Z> is required');
  process.exit(2);
}

const dryRun = args['dry-run'];
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

// The CLIs always come from this checkout's pinned devDependencies, whatever --root is.
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRequire = createRequire(path.join(repo, 'packages/vscode-extension/package.json'));
function cli(name) {
  const manifestPath = extensionRequire.resolve(`${name}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const [command, bin] =
    typeof manifest.bin === 'string' ? [name, manifest.bin] : Object.entries(manifest.bin)[0];
  return {
    name: command,
    version: manifest.version,
    bin: path.join(path.dirname(manifestPath), bin),
  };
}
const vsce = cli('@vscode/vsce');
const ovsx = cli('ovsx');

const root = path.resolve(args.root ?? repo);
const extensionDir = path.join(root, 'packages/vscode-extension');
const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
const { name, publisher, version } = manifest;

if (args.tag !== `v${version}`) {
  fail(`tag ${args.tag} does not match the extension's version ${version} (expected v${version})`);
}
const vsixName = `${name}-${version}.vsix`;
const vsix = path.join(extensionDir, vsixName);
if (!existsSync(vsix)) fail(`${path.relative(root, vsix)} not found; run \`pnpm package\` first`);

const tokens = ['VSCE_PAT', 'OVSX_PAT'];
if (dryRun) {
  const present = tokens.filter((token) => process.env[token]);
  if (present.length > 0) fail(`--dry-run refuses to run with ${present.join(', ')} set`);
} else {
  const missing = tokens.filter((token) => !process.env[token]);
  if (missing.length > 0) {
    fail(
      `${missing.join(', ')} not set; the release job reads them from the \`release\` environment`,
    );
  }
}

console.log(
  `release: ${publisher}.${name} ${version} from ${vsixName}` +
    (dryRun ? ' (dry run: nothing is published)' : ''),
);

function run(tool, argv) {
  const result = spawnSync(process.execPath, [tool.bin, ...argv], {
    cwd: extensionDir,
    encoding: 'utf8',
    stdio: dryRun ? 'pipe' : 'inherit',
  });
  if (result.error) fail(`${tool.name} ${argv[0]}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${tool.name} ${argv.join(' ')} exited ${result.status}\n${result.stderr ?? ''}`);
  }
  return result;
}

// A dry run proves each step's command line against the pinned CLI instead of running it.
function step(label, tool, argv) {
  const command = `${tool.name} ${argv.join(' ')}`;
  if (!dryRun) {
    console.log(`release: ${label}: ${command}`);
    run(tool, argv);
    return;
  }
  const help = run(tool, [argv[0], '--help']).stdout;
  const unknown = argv.filter((arg) => arg.startsWith('-') && !help.includes(arg));
  if (unknown.length > 0)
    fail(`${label}: ${tool.name} ${tool.version} has no ${unknown.join(', ')}`);
  console.log(`release: ${label}: would run ${command} (${tool.name} ${tool.version}, flags ok)`);
}

step('Marketplace publish (VSCE_PAT)', vsce, [
  'publish',
  '--packagePath',
  vsixName,
  '--skip-duplicate',
]);

const namespaceUrl = `${OPEN_VSX}/api/${encodeURIComponent(publisher)}`;
if (dryRun) {
  step(`Open VSX namespace, only if ${namespaceUrl} is 404 (OVSX_PAT)`, ovsx, [
    'create-namespace',
    publisher,
  ]);
} else {
  const response = await fetch(namespaceUrl).catch((error) => fail(`${namespaceUrl}: ${error}`));
  if (response.status === 404) {
    step('Open VSX namespace (OVSX_PAT)', ovsx, ['create-namespace', publisher]);
  } else if (response.ok) {
    console.log(`release: Open VSX namespace ${publisher} exists`);
  } else {
    fail(`${namespaceUrl} answered ${response.status}; not publishing to Open VSX`);
  }
}

step('Open VSX publish (OVSX_PAT)', ovsx, ['publish', vsixName, '--skip-duplicate']);

console.log(dryRun ? 'release: dry run ok' : `release: published ${publisher}.${name} ${version}`);
