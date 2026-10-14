// YAML import (spec 017 Y1–Y8, plan 017 §Approach): `yaml` 2.9.1 parses and composes; our own walk
// over its nodes (not `toJS`) gives A2's numbers from the source text, Y4's keys, Y5's merges, Y6's
// alias limit and Y7's ignored tags.
//
// Depth: `yaml`'s composer recurses about 1.3 KB of stack per nesting level, so it overflows Node's
// default stack near 780 levels, and V8 can abort the whole process when a regular expression
// compiles that close to the limit. The CST from `Parser` is built without recursion, so its depth
// is checked first and the composer never sees a document nested more than YAML_MAX_DEPTH levels.
import {
  Composer,
  type Alias,
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  Parser,
  type CST,
  type Document,
  type Node,
  type Scalar,
} from 'yaml';
import { jsonText, LosslessNumber } from '../formats/numbers.js';
import {
  decimalData,
  ImportFailure,
  integerData,
  Lines,
  MAX_DEPTH,
  nonFinite,
  setMember,
  tooDeep,
  Warnings,
  type ImportResult,
} from './common.js';

/** The deepest YAML data converted (A5, narrowed for YAML; see the header). */
export const YAML_MAX_DEPTH = 500;
export const YAML_DEPTH_MESSAGE =
  'The YAML file is nested too deeply to convert (more than 500 levels)';
export const Y6_MESSAGE = "The YAML file's aliases expand too far";
/** Y6: the most values aliases may add to the data. */
export const MAX_ALIAS_VALUES = 1_000_000;

const OPTIONS = {
  intAsBigInt: true,
  merge: true,
  uniqueKeys: false,
  maxAliasCount: -1,
  prettyErrors: false,
} as const;

const CORE = 'tag:yaml.org,2002:';
/** Y7: the core schema's tags, which apply. */
const CORE_TAGS = new Set(
  ['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map((t) => CORE + t),
);

const depthError = (depth: number): ImportFailure =>
  depth > MAX_DEPTH ? tooDeep() : new ImportFailure(YAML_DEPTH_MESSAGE, 1);

/** The nesting depth of a CST token's collections, walked without recursion. */
function cstDepth(token: CST.Token | undefined): number {
  let max = 0;
  const stack: [CST.Token | null | undefined, number][] = [[token, 1]];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [t, depth] = next;
    if (!t || (t.type !== 'block-map' && t.type !== 'block-seq' && t.type !== 'flow-collection'))
      continue;
    if (depth > max) max = depth;
    if (max > MAX_DEPTH) return max;
    for (const item of t.items) {
      const { key, value } = item as { key?: CST.Token | null; value?: CST.Token };
      stack.push([key, depth + 1], [value, depth + 1]);
    }
  }
  return max;
}

export function importYaml(text: string): ImportResult {
  const lines = new Lines(text);
  const tokens = Array.from(new Parser().parse(text));
  const starts: number[] = [];
  for (const token of tokens) {
    if (token.type !== 'document') continue;
    starts.push(token.offset);
    const depth = cstDepth(token.value);
    if (depth > YAML_MAX_DEPTH) throw depthError(depth);
  }
  const composer = new Composer(OPTIONS);
  const docs: Document.Parsed[] = Array.from(composer.compose(tokens));

  // Y8: the first error of any document, else of the stream.
  const errors = docs.length > 0 ? docs.flatMap((d) => d.errors) : composer.streamInfo().errors;
  if (errors.length > 0) {
    const first = errors.reduce((a, b) => (b.pos[0] < a.pos[0] ? b : a));
    if (/call stack/i.test(first.message)) throw tooDeep();
    throw new ImportFailure(first.message, lines.line(first.pos[0]), lines.column(first.pos[0]));
  }

  const warnings = new Warnings(lines);
  const tags = new Map<string, { offset: number; nodes: Set<Node> }>();
  const aliases = { added: 0 };
  const walks = docs.map((doc) => new Walk(doc, text, warnings, tags, aliases));
  // Y6 before any copy: when the aliases surely add more values than the limit, the walk would
  // fail the same way, but only after building up to a million values (criterion 4's 1 s).
  let least = 0;
  for (const [i, walk] of walks.entries()) least += walk.aliasesAdd(docs[i]!.contents);
  if (least > MAX_ALIAS_VALUES) throw new ImportFailure(Y6_MESSAGE, 1);
  const values = walks.map((walk, i) => walk.value(docs[i]!.contents, [], 0));
  for (const [tag, { offset, nodes }] of tags) {
    const n = nodes.size;
    warnings.add(`Tag ${tag} was ignored (${n} ${n === 1 ? 'place' : 'places'})`, offset);
  }
  if (docs.length > 1) {
    warnings.add(
      `The file holds ${docs.length} YAML documents; they became one array`,
      starts[1] ?? 0,
    );
  }
  // Y2: no document is null; several are an array.
  const data = docs.length === 0 ? null : docs.length === 1 ? values[0] : values;
  return { data, warnings: warnings.sorted() };
}

type Path = (string | number)[];

class Walk {
  /** How many aliases the walk is inside; values count against Y6 while it is above 0. */
  private inAlias = 0;
  /** Alias targets: `Alias.resolve` searches the whole document each time it is called. */
  private readonly targets = new Map<Node, Node | undefined>();
  /** `leastAdded` of alias targets, and the targets being counted (a guard against cycles). */
  private readonly counts = new Map<Node, number>();
  private readonly counting = new Set<Node>();

  constructor(
    private readonly doc: Document.Parsed,
    private readonly text: string,
    private readonly warnings: Warnings,
    private readonly tags: Map<string, { offset: number; nodes: Set<Node> }>,
    /** Y6: values aliases have added so far, over all the file's documents. */
    private readonly aliases: { added: number },
  ) {}

  value(node: unknown, path: Path, depth: number): unknown {
    if (isAlias(node)) {
      const target = this.resolve(node);
      if (!target) throw this.unresolved(node.source, node.range?.[0] ?? 0);
      this.inAlias++;
      try {
        return this.value(target, path, depth);
      } finally {
        this.inAlias--;
      }
    }
    if (this.inAlias > 0 && ++this.aliases.added > MAX_ALIAS_VALUES)
      throw new ImportFailure(Y6_MESSAGE, 1);
    if (node === null || node === undefined) return null;
    if (isScalar(node)) return this.scalar(node, path);
    if (isMap(node) || isSeq(node)) {
      this.tag(node, (node as Node).range?.[0] ?? 0);
      if (depth + 1 > YAML_MAX_DEPTH) throw depthError(depth + 1);
      if (isSeq(node)) {
        const items: unknown[] = [];
        node.items.forEach((item, i) => {
          path.push(i);
          // A `!!omap` or `!!pairs` holds pairs: each is read as the one-member mapping it is written as.
          items.push(
            isPair(item)
              ? this.mapping([item], path, depth + 2, 0)
              : this.value(item, path, depth + 1),
          );
          path.pop();
        });
        return items;
      }
      return this.mapping(node.items, path, depth + 1, node.range?.[0] ?? 0);
    }
    return null;
  }

  /** A mapping's members (A4, Y4, Y5). `depth` is the mapping's own level. */
  private mapping(pairs: readonly unknown[], path: Path, depth: number, offset: number): unknown {
    if (depth > YAML_MAX_DEPTH) throw depthError(depth);
    const object: Record<string, unknown> = {};
    /** Keys written in this mapping, as opposed to merged into it (Y4's repeated keys). */
    const written = new Set<string>();
    for (const pair of pairs) {
      if (!isPair(pair)) continue;
      const keyNode = pair.key as Node | null;
      if (isScalar(keyNode) && typeof keyNode.value === 'symbol') {
        this.merge(object, pair.value, path, depth);
        continue;
      }
      const key = this.key(keyNode, path, depth, offset);
      if (written.has(key)) {
        this.warnings.add(
          `Key ${JSON.stringify(key)} is repeated; its last value is kept`,
          keyNode?.range?.[0] ?? offset,
        );
      }
      written.add(key);
      path.push(key);
      setMember(object, key, this.value(pair.value, path, depth));
      path.pop();
    }
    return object;
  }

  /** Y5: the members of the merged mappings not already in `object`, earlier mappings first. */
  private merge(object: Record<string, unknown>, value: unknown, path: Path, depth: number): void {
    const sources = isSeq(value) ? value.items : [value];
    for (const source of sources) {
      const merged = this.value(source, path, depth - 1);
      if (typeof merged !== 'object' || merged === null || Array.isArray(merged)) continue;
      for (const key of Object.keys(merged)) {
        if (!Object.prototype.hasOwnProperty.call(object, key))
          setMember(object, key, (merged as Record<string, unknown>)[key]);
      }
    }
  }

  /** Y4: a key's text. */
  private key(node: Node | null, path: Path, depth: number, mapOffset: number): string {
    if (node === null || node === undefined) return '';
    let target: unknown = node;
    if (isAlias(node)) {
      target = this.resolve(node);
      if (!target) throw this.unresolved(node.source, node.range?.[0] ?? mapOffset);
    }
    if (isScalar(target)) {
      const tagged = this.tag(target as Node, target.range?.[0] ?? mapOffset);
      const value = tagged ? this.untagged(target).value : target.value;
      return typeof value === 'string' ? value : String(target.source ?? value);
    }
    const data = this.value(node, path, depth);
    const key = jsonText(data) ?? 'null';
    this.warnings.add(
      `Key ${key} is a sequence or mapping; it became its JSON text`,
      this.questionMark(node.range?.[0] ?? mapOffset),
    );
    return key;
  }

  /** The `?` that introduces a complex key starting at `offset`, if it is there. */
  private questionMark(offset: number): number {
    let i = offset - 1;
    while (i >= 0 && /\s/.test(this.text[i]!)) i--;
    return this.text[i] === '?' ? i : offset;
  }

  private scalar(node: Scalar, path: Path): unknown {
    const offset = node.range?.[0] ?? 0;
    const resolved = this.tag(node, offset) ? this.untagged(node) : node;
    const value = resolved.value;
    const source = typeof node.source === 'string' ? node.source : String(value);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'bigint') {
      // `-0` is an integer whose digits are written `-0` (corpus README, reading 12).
      if (value === 0n && source.trimStart().startsWith('-')) return -0;
      return integerData(value);
    }
    if (typeof value === 'number') {
      const decimal = decimalData(yamlDecimalText(source));
      if (decimal !== undefined) return decimal;
      if (Number.isFinite(value)) return value;
      this.warnings.add(nonFinite(path, source), offset);
      return null;
    }
    if (value instanceof LosslessNumber) return value;
    // A YAML 1.1 timestamp (Y1) or any other value a tag made: the text as written.
    return source;
  }

  /** Y7: the scalar read as if it had no tag. A plain scalar is resolved by the schema's implicit
   *  tags, as the composer resolves untagged ones; a quoted or block scalar is a string. */
  private untagged(node: Scalar): { value: unknown } {
    const source = typeof node.source === 'string' ? node.source : String(node.value);
    if (node.type !== 'PLAIN') return { value: source };
    const tag = this.doc.schema.tags.find(
      (t) => t.default === true && 'test' in t && t.test instanceof RegExp && t.test.test(source),
    );
    if (!tag || !('resolve' in tag)) return { value: source };
    try {
      const value: unknown = (tag.resolve as (s: string, e: () => void, o: object) => unknown)(
        source,
        () => {},
        this.doc.options,
      );
      return { value: isScalar(value) ? value.value : value };
    } catch {
      return { value: source };
    }
  }

  /** Y7: whether `node` carries a tag outside the core schema; counts its first use. */
  private tag(node: Node, offset: number): boolean {
    const tag = node.tag;
    if (tag === undefined || CORE_TAGS.has(tag)) return false;
    const written = tag.startsWith(CORE) ? `!!${tag.slice(CORE.length)}` : tag;
    let uses = this.tags.get(written);
    if (!uses) this.tags.set(written, (uses = { offset, nodes: new Set() }));
    uses.nodes.add(node);
    if (offset < uses.offset) uses.offset = offset;
    return true;
  }

  /** A lower bound of the values the aliases in `node` (not inside an alias) add to the data:
   *  aliases in sequence items and mapping values; keys and merge keys are left out. */
  aliasesAdd(node: unknown): number {
    let total = 0;
    const stack: unknown[] = [node];
    while (stack.length > 0 && total <= MAX_ALIAS_VALUES) {
      const next = stack.pop();
      if (isAlias(next)) total += this.leastAdded(next);
      else if (isSeq(next))
        for (const item of next.items) stack.push(isPair(item) ? item.value : item);
      else if (isMap(next)) {
        for (const pair of next.items) {
          const key = pair.key as Node | null;
          if (!(isScalar(key) && typeof key.value === 'symbol')) stack.push(pair.value);
        }
      }
    }
    return total;
  }

  /** Values the walk surely counts for `node` inside an alias (a lower bound: merge keys and
   *  collection keys are left out), with each alias target's count kept. */
  private leastAdded(node: unknown): number {
    if (isAlias(node)) {
      const target = this.resolve(node);
      if (!target || this.counting.has(target)) return 0;
      let count = this.counts.get(target);
      if (count === undefined) {
        this.counting.add(target);
        count = this.leastAdded(target);
        this.counting.delete(target);
        this.counts.set(target, count);
      }
      return count;
    }
    let count = 1;
    if (isSeq(node)) {
      for (const item of node.items)
        count += isPair(item) ? this.leastAdded(item.value) : this.leastAdded(item);
    } else if (isMap(node)) {
      for (const pair of node.items) {
        const key = pair.key as Node | null;
        if (isScalar(key) && typeof key.value === 'symbol') continue;
        count += this.leastAdded(pair.value);
      }
    }
    return count > MAX_ALIAS_VALUES ? MAX_ALIAS_VALUES + 1 : count;
  }

  private resolve(alias: Alias): Node | undefined {
    if (!this.targets.has(alias)) this.targets.set(alias, alias.resolve(this.doc));
    return this.targets.get(alias);
  }

  private unresolved(source: string, offset: number): ImportFailure {
    const lines = new Lines(this.text);
    return new ImportFailure(
      `Unresolved alias (the first occurrence of the anchor is not yet defined): *${source}`,
      lines.line(offset),
      lines.column(offset),
    );
  }
}

/** A2's decimal text of a YAML float as written: a leading `+` and YAML 1.1's `_` dropped, `.5` as
 *  `0.5`, `5.` as `5`. Anything that is still no RFC 8259 number (`.inf`, `.nan`, a YAML 1.1
 *  base-60 float) is left for the caller. */
function yamlDecimalText(source: string): string {
  const text = source.trim().replace(/_/g, '');
  const sign = text[0] === '-' ? '-' : '';
  const body = text[0] === '-' || text[0] === '+' ? text.slice(1) : text;
  const leading = body[0] === '.' ? `0${body}` : body;
  return sign + leading.replace(/\.(?![0-9])/, '');
}
