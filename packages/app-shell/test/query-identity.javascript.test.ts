// Spec 011 criterion 3 in JavaScript: see query-identity.ts.
import { describe } from 'vitest';
import { identityProperty, RUNS, SEED } from './query-identity.js';

describe('identity query in the engine (spec 011 criterion 3)', () => {
  identityProperty('javascript', SEED, RUNS);
});
