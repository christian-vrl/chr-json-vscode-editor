// `pnpm test:golden` (002 T1). Parses this script's own flags, then runs the Vitest `golden`
// project. Vitest ignores flags it does not know, so a gate naming a flag nothing reads would pass
// vacuously; here every flag is either understood or an error.
//
//   --coverage-only       run only the coverage tests (spec 002 criterion 4, spec 006 criterion 2,
//                         spec 009 criterion 2, spec 010 criterion 2, spec 012 criterion 2)
//   --format a,b          only cases of these formats (json, jsonc, json5)
//   --op a,b              only cases with these `op` tags
//
// The case filters reach the tests through GOLDEN_FORMAT and GOLDEN_OP (read by
// tests/golden/filter.ts), and a filtered run fails when it selects no case.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Formats and tag values have one source, shared with tests/golden/coverage.ts.
const vocabulary = JSON.parse(
  readFileSync(new URL('../tests/golden/tags.json', import.meta.url), 'utf8'),
);
const listFlags = { '--format': vocabulary.formats, '--op': vocabulary.tags.op };

function fail(message) {
  console.error(`test:golden: ${message}`);
  console.error('usage: pnpm test:golden [-- [--coverage-only] [--format a,b] [--op a,b]]');
  process.exit(2);
}

const args = process.argv.slice(2);
// pnpm forwards the `--` of `pnpm test:golden -- --flag` as an argument.
if (args[0] === '--') args.shift();

let coverageOnly = false;
const filters = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const [flag, inline] = arg.split(/=(.*)/s, 2);
  if (flag === '--coverage-only' && inline === undefined) {
    coverageOnly = true;
  } else if (flag in listFlags) {
    if (flag in filters) fail(`${flag} given twice`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '' || value.startsWith('--'))
      fail(`${flag} needs a value`);
    const values = value.split(',');
    const unknown = values.filter((v) => !listFlags[flag].includes(v));
    if (unknown.length > 0) {
      fail(`unknown ${flag} value ${unknown.join(', ')} (known: ${listFlags[flag].join(', ')})`);
    }
    filters[flag] = values.join(',');
  } else {
    fail(`unknown argument ${arg}`);
  }
}
if (coverageOnly && Object.keys(filters).length > 0) {
  fail('--coverage-only checks the whole corpus and takes no --format or --op');
}

const vitestArgs = ['exec', 'vitest', 'run', '--project', 'golden'];
if (coverageOnly) {
  vitestArgs.push(
    'tests/golden/coverage.test.ts',
    'tests/golden/convert-coverage.test.ts',
    'tests/golden/csv-coverage.test.ts',
    'tests/golden/smart-format-coverage.test.ts',
    'tests/golden/jsonl-coverage.test.ts',
  );
}

const env = { ...process.env };
delete env.GOLDEN_FORMAT;
delete env.GOLDEN_OP;
if (filters['--format']) env.GOLDEN_FORMAT = filters['--format'];
if (filters['--op']) env.GOLDEN_OP = filters['--op'];

const result = spawnSync('pnpm', vitestArgs, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
