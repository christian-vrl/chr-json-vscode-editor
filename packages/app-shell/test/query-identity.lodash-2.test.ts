// Spec 011 criterion 3 in Lodash, part 2 of LODASH_SHARDS: see query-identity.ts.
import { describe } from 'vitest';
import { identityProperty, LODASH_SHARDS, RUNS, SEED } from './query-identity.js';

describe('identity query in the engine (spec 011 criterion 3)', () => {
  identityProperty('lodash', SEED + 2, RUNS / LODASH_SHARDS);
});
