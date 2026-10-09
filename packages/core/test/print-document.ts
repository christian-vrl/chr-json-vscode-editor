// Documents with comments for format-core property tests (002 T6, shared with 002 T10): data in a
// format and style, printed with comments in every place the golden corpus tags (`before` lines, with
// or without a blank line; `after` on the member's line; `inline` between key and value or before the
// comma; comments in single-line and empty containers, before a closing bracket and around the
// root), mixing single-line and multi-line containers.
import fc from 'fast-check';
import { stringify, type Format, type Style } from '../src/index.js';

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A document for `data` in `format` and `style`, with numbered comments `// c1`, `/* c2 *\/`. */
export function printDocument(
  data: unknown,
  format: Format,
  style: Style,
  g: fc.GeneratorValue,
): string {
  const commented = format !== 'json';
  const trailing = format !== 'json' && style.trailingCommas;
  const unit = style.indent === '\t' ? '\t' : ' '.repeat(style.indent);
  const eol = style.eol;
  const scalarStyle = { ...style, finalNewline: false };
  let n = 0;
  const chance = (p: number) => commented && g(fc.integer, { min: 1, max: 100 }) <= p;
  const lineComment = () => `// c${++n}`;
  const blockComment = () => `/* c${++n} */`;
  const anyComment = () => (g(fc.boolean) ? lineComment() : blockComment());
  const key = (k: string) =>
    format === 'json5' && style.unquotedKeys && identifier.test(k)
      ? k
      : stringify(k, format, scalarStyle);

  function value(v: unknown, indent: string): string {
    if (v === null || typeof v !== 'object') return stringify(v, format, scalarStyle);
    const isArray = Array.isArray(v);
    const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
    const entries: [string | undefined, unknown][] = isArray
      ? v.map((item) => [undefined, item])
      : Object.entries(v);
    const name = (k: string | undefined) =>
      k === undefined ? '' : `${key(k)}: ${chance(10) ? `${blockComment()} ` : ''}`;
    const inner = indent + unit;

    if (entries.length === 0) {
      if (chance(10)) return `${open} ${blockComment()} ${close}`;
      if (unit !== '' && chance(10))
        return `${open}${eol}${inner}${anyComment()}${eol}${indent}${close}`;
      if (unit !== '' && g(fc.integer, { min: 1, max: 10 }) === 1)
        return `${open}${eol}${indent}${close}`;
      return `${open}${close}`;
    }
    if (unit === '' || g(fc.integer, { min: 1, max: 4 }) === 1) {
      // One line: block comments only.
      const sep = g(fc.boolean) ? ', ' : ',';
      const items = entries.map(
        ([k, item]) =>
          `${chance(10) ? `${blockComment()} ` : ''}${name(k)}${value(item, indent)}${chance(10) ? ` ${blockComment()}` : ''}`,
      );
      return `${open}${items.join(sep)}${trailing ? ',' : ''}${close}`;
    }
    let text = open + eol;
    entries.forEach(([k, item], i) => {
      if (chance(20)) {
        const lines = g(fc.integer, { min: 1, max: 2 });
        for (let l = 0; l < lines; l++) text += `${inner}${anyComment()}${eol}`;
        if (chance(30)) text += eol;
      }
      const comma = i < entries.length - 1 || trailing ? ',' : '';
      const beforeComma = chance(5) ? ` ${blockComment()}` : '';
      const after = chance(20) ? ` ${anyComment()}` : '';
      text += `${inner}${name(k)}${value(item, inner)}${beforeComma}${comma}${after}${eol}`;
    });
    if (chance(10)) text += `${inner}${anyComment()}${eol}`;
    return `${text}${indent}${close}`;
  }

  let text = '';
  if (chance(20)) text += `${anyComment()}${eol}`;
  text += value(data, '');
  if (chance(10)) text += ` ${blockComment()}`;
  if (style.finalNewline) text += eol;
  return text;
}
