// The two comment-keeping repair engines the spike measures, behind one signature.
import * as diff from './engine-diff.ts';
import * as tagged from './engine-tagged.ts';

export interface EngineResult {
  text: string;
  /** D: comments inserted because their placeholder was lost; T: comments whose tag was lost. */
  unplaced: number;
}

export const ENGINES: Record<string, { name: string; repair: (text: string) => EngineResult }> = {
  D: {
    name: 'D, diff re-anchoring (engine-diff.ts)',
    repair: (t) => {
      const r = diff.repairKeepingComments(t);
      return { text: r.text, unplaced: r.inserted };
    },
  },
  T: {
    name: 'T, tagged whitespace (engine-tagged.ts)',
    repair: (t) => {
      const r = tagged.repairKeepingComments(t);
      return { text: r.text, unplaced: r.lost.length };
    },
  },
};
