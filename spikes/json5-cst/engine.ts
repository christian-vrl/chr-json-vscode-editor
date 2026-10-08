// Shared edit engine for the 002 T4 spike (UNK-012). Every tree-producing option maps its parser's
// output to `CstNode` and runs through this one engine, so a pass or fail measures the parser
// (does it accept the input, are its offsets right, does it decode keys), not the edit code.
// It implements only what the 20 spike cases need: add, replace and remove under spec 002
// R1-R10 and UNK-008, with the spike-local readings written in cases/README.md.

export type CstNode =
  | { kind: 'object'; start: number; end: number; members: CstMember[] }
  | { kind: 'array'; start: number; end: number; items: CstNode[] }
  | { kind: 'scalar'; start: number; end: number };

export interface CstMember {
  key: string; // decoded name
  keyStart: number;
  keyEnd: number;
  value: CstNode;
}

/** UTF-16 offsets into the text; `end` is exclusive. Throws when the text does not parse. */
export type ParseTree = (text: string) => CstNode;

export interface PatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

type Container = Extract<CstNode, { kind: 'object' | 'array' }>;
interface Span {
  start: number;
  end: number;
}
interface Trivia {
  t: 'ws' | 'nl' | 'line' | 'block' | 'comma';
  s: number;
  e: number;
}
interface Edit {
  at: number;
  del: number;
  ins: string;
}

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/y;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function applyPatch(text: string, ops: PatchOp[], parse: ParseTree): string {
  let out = text;
  for (const op of ops) out = applyOp(out, op, parse(out));
  return out;
}

function applyOp(text: string, op: PatchOp, root: CstNode): string {
  const tokens = op.path
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = tokens.pop();
  if (last === undefined) throw new Error('whole-document ops are out of the spike');
  let parent = root;
  for (const t of tokens) {
    const child = childOf(parent, t);
    if (!child) throw new Error(`path not found: ${op.path}`);
    parent = child;
  }
  if (parent.kind === 'scalar') throw new Error(`not a container: ${op.path}`);
  const ctx = new Ctx(text, root);
  const edits = editsFor(ctx, parent, last, op);
  edits.sort((a, b) => b.at - a.at);
  let out = text;
  for (const e of edits) out = out.slice(0, e.at) + e.ins + out.slice(e.at + e.del);
  return out;
}

function childOf(node: CstNode, token: string): CstNode | undefined {
  if (node.kind === 'object') {
    const i = lastMember(node, token);
    return i < 0 ? undefined : node.members[i]!.value;
  }
  if (node.kind === 'array')
    return /^(0|[1-9]\d*)$/.test(token) ? node.items[Number(token)] : undefined;
  return undefined;
}

/** Index of the last member named `key` (a later duplicate wins, as in `JSON.parse`); -1 if none. */
function lastMember(obj: Extract<CstNode, { kind: 'object' }>, key: string): number {
  for (let i = obj.members.length - 1; i >= 0; i--) if (obj.members[i]!.key === key) return i;
  return -1;
}

function editsFor(ctx: Ctx, parent: Container, last: string, op: PatchOp): Edit[] {
  if (parent.kind === 'object') {
    const index = lastMember(parent, last);
    if (op.op === 'add' && index < 0) {
      return ctx.insert(
        parent,
        parent.members.length,
        `${ctx.key(parent, last)}: ${ctx.value(op.value)}`,
      );
    }
    if (index < 0) throw new Error(`path not found: ${op.path}`);
    const member = parent.members[index]!;
    if (op.op === 'remove') return ctx.remove(parent, index);
    return [
      {
        at: member.value.start,
        del: member.value.end - member.value.start,
        ins: ctx.value(op.value),
      },
    ];
  }
  const index = last === '-' ? parent.items.length : Number(last);
  if (!(last === '-' || /^(0|[1-9]\d*)$/.test(last)) || index > parent.items.length) {
    throw new Error(`bad array index: ${op.path}`);
  }
  if (op.op === 'add') return ctx.insert(parent, index, ctx.value(op.value));
  const item = parent.items[index];
  if (!item) throw new Error(`path not found: ${op.path}`);
  if (op.op === 'remove') return ctx.remove(parent, index);
  return [{ at: item.start, del: item.end - item.start, ins: ctx.value(op.value) }];
}

class Ctx {
  readonly text: string;
  readonly eol: string;
  readonly quote: string;

  constructor(text: string, root: CstNode) {
    this.text = text;
    const m = /\r\n|\n/.exec(text);
    this.eol = m ? m[0] : '\n';
    let single = 0;
    let double = 0;
    const count = (pos: number) => {
      if (text[pos] === "'") single++;
      else if (text[pos] === '"') double++;
    };
    const walk = (n: CstNode) => {
      if (n.kind === 'scalar') count(n.start);
      else if (n.kind === 'array') n.items.forEach(walk);
      else
        for (const m of n.members) {
          count(m.keyStart);
          walk(m.value);
        }
    };
    walk(root);
    this.quote = single > double ? "'" : '"';
  }

  value(v: unknown): string {
    if (typeof v === 'string') return this.str(v);
    if (Array.isArray(v)) return `[${v.map((x) => this.value(x)).join(', ')}]`;
    if (v !== null && typeof v === 'object') {
      const body = Object.entries(v).map(([k, x]) => `${this.str(k)}: ${this.value(x)}`);
      return `{${body.join(', ')}}`;
    }
    return JSON.stringify(v);
  }

  str(s: string): string {
    const json = JSON.stringify(s);
    if (this.quote === '"') return json;
    return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
  }

  key(obj: Extract<CstNode, { kind: 'object' }>, name: string): string {
    const unquoted = obj.members.filter((m) => !`'"`.includes(this.text[m.keyStart]!)).length;
    return IDENTIFIER.test(name) && unquoted * 2 > obj.members.length ? name : this.str(name);
  }

  children(c: Container): Span[] {
    if (c.kind === 'array') return c.items;
    return c.members.map((m) => ({ start: m.keyStart, end: m.value.end }));
  }

  /** Trivia between child i-1 and child i (i = 0: after the open bracket; i = n: before the close). */
  gap(c: Container, i: number): Trivia[] {
    const open = c.kind === 'object' ? '{' : '[';
    const close = c.kind === 'object' ? '}' : ']';
    if (this.text[c.start] !== open || this.text[c.end - 1] !== close) {
      throw new Error(`container offsets do not point at ${open}…${close}`);
    }
    const kids = this.children(c);
    const from = i === 0 ? c.start + 1 : kids[i - 1]!.end;
    const to = i === kids.length ? c.end - 1 : kids[i]!.start;
    return scanTrivia(this.text, from, to);
  }

  lineStart(pos: number): number {
    let p = pos;
    while (p > 0 && !'\n\r\u2028\u2029'.includes(this.text[p - 1]!)) p--;
    return p;
  }

  indentOf(child: Span): string {
    return this.text.slice(this.lineStart(child.start), child.start);
  }

  /** End of the last comma or comment before the first line break in `tokens`. */
  trailingEnd(tokens: Trivia[], fallback: number): number {
    let end = fallback;
    for (const t of tokens) {
      if (t.t === 'nl') break;
      if (t.t !== 'ws') end = t.e;
    }
    return end;
  }

  /** Start of the comment lines directly above child i (UNK-008), or of the child's own line. */
  leadStart(c: Container, i: number): number {
    const tokens = this.gap(c, i);
    const firstNl = tokens.findIndex((t) => t.t === 'nl');
    const lines: Trivia[][] = [[]];
    for (const t of tokens.slice(firstNl + 1)) {
      if (t.t === 'nl') lines.push([]);
      else lines[lines.length - 1]!.push(t);
    }
    const kid = this.children(c)[i]!;
    let start = this.lineStart(kid.start);
    for (let l = lines.length - 2; l >= 0; l--) {
      const line = lines[l]!;
      if (!line.some((t) => t.t === 'line' || t.t === 'block')) break;
      if (line.some((t) => t.t === 'comma')) break;
      start = this.lineStart(line[0]!.s);
    }
    return start;
  }

  insert(c: Container, index: number, entry: string): Edit[] {
    const kids = this.children(c);
    const n = kids.length;
    if (n === 0) throw new Error('insert into an empty container is out of the spike');
    if (index < n) {
      const kid = kids[index]!;
      if (this.gap(c, index).some((t) => t.t === 'nl')) {
        return [
          {
            at: this.leadStart(c, index),
            del: 0,
            ins: `${this.indentOf(kid)}${entry},${this.eol}`,
          },
        ];
      }
      return [{ at: kid.start, del: 0, ins: `${entry},${this.separator(c)}` }];
    }
    const lastKid = kids[n - 1]!;
    const tail = this.gap(c, n);
    const comma = tail.find((t) => t.t === 'comma');
    if (tail.some((t) => t.t === 'nl')) {
      const at = this.trailingEnd(tail, lastKid.end);
      const edits: Edit[] = [
        { at, del: 0, ins: `${this.eol}${this.indentOf(lastKid)}${entry}${comma ? ',' : ''}` },
      ];
      if (!comma) edits.push({ at: lastKid.end, del: 0, ins: ',' });
      return edits;
    }
    if (comma) return [{ at: comma.e, del: 0, ins: `${this.separator(c)}${entry},` }];
    return [{ at: lastKid.end, del: 0, ins: `,${this.separator(c)}${entry}` }];
  }

  /** Whitespace written after a comma between members on one line; one space by default. */
  separator(c: Container): string {
    if (this.children(c).length < 2) return ' ';
    const tokens = this.gap(c, 1);
    const comma = tokens.findIndex((t) => t.t === 'comma');
    const after = tokens.slice(comma + 1);
    if (after.every((t) => t.t === 'ws'))
      return after.map((t) => this.text.slice(t.s, t.e)).join('');
    return ' ';
  }

  remove(c: Container, index: number): Edit[] {
    const kids = this.children(c);
    const n = kids.length;
    if (n === 1) throw new Error('removing the only member is out of the spike');
    const kid = kids[index]!;
    const before = this.gap(c, index);
    const after = this.gap(c, index + 1);
    const ownLine = before.some((t) => t.t === 'nl') && after.some((t) => t.t === 'nl');
    if (ownLine) {
      const nl = after.find((t) => t.t === 'nl')!;
      const start = this.leadStart(c, index);
      const edits: Edit[] = [{ at: start, del: nl.e - start, ins: '' }];
      const isLast = index === n - 1;
      if (isLast && !after.some((t) => t.t === 'comma')) {
        const prevComma = before.find((t) => t.t === 'comma');
        if (prevComma) edits.push({ at: prevComma.s, del: 1, ins: '' });
      }
      return edits;
    }
    if (index < n - 1) return [{ at: kid.start, del: kids[index + 1]!.start - kid.start, ins: '' }];
    const prev = kids[index - 1]!;
    return [{ at: prev.end, del: kid.end - prev.end, ins: '' }];
  }
}

/** Splits a stretch that must hold only JSON5 trivia; throws on anything else (bad offsets). */
export function scanTrivia(text: string, from: number, to: number): Trivia[] {
  const out: Trivia[] = [];
  let p = from;
  while (p < to) {
    const ch = text[p]!;
    NEWLINE.lastIndex = p;
    const nl = NEWLINE.exec(text);
    if (nl) {
      out.push({ t: 'nl', s: p, e: p + nl[0].length });
      p += nl[0].length;
    } else if (ch === ',') {
      out.push({ t: 'comma', s: p, e: p + 1 });
      p++;
    } else if (text.startsWith('//', p)) {
      let e = p + 2;
      while (e < to && !'\n\r\u2028\u2029'.includes(text[e]!)) e++;
      out.push({ t: 'line', s: p, e });
      p = e;
    } else if (text.startsWith('/*', p)) {
      const close = text.indexOf('*/', p + 2);
      if (close < 0 || close + 2 > to) throw new Error(`unterminated comment at ${p}`);
      out.push({ t: 'block', s: p, e: close + 2 });
      p = close + 2;
    } else if (/[\t\v\f \u00A0\uFEFF\p{Zs}]/u.test(ch)) {
      const last = out[out.length - 1];
      if (last?.t === 'ws' && last.e === p) last.e++;
      else out.push({ t: 'ws', s: p, e: p + 1 });
      p++;
    } else {
      throw new Error(`unexpected ${JSON.stringify(ch)} at offset ${p} between tokens`);
    }
  }
  return out;
}
