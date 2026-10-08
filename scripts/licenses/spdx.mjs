// SPDX license-expression evaluation for check:licenses (001 T7, AGENTS.md rule 4).
//
// Grammar (SPDX 2.3 Annex D), loosest binding first:
//   or   := and ('OR' and)*
//   and  := with ('AND' with)*
//   with := atom ('WITH' exception)?
//   atom := id | '(' or ')'
// Operators are accepted all-uppercase or all-lowercase, as SPDX allows; ids match the allowlist
// case-insensitively. `A WITH exception` is allowed when A is, because an SPDX exception only grants
// extra permissions. Anything else (`MIT+`, `LicenseRef-…`, `UNLICENSED`, `SEE LICENSE IN …`, a
// missing license, a syntax error) is not allowed: the check fails closed.

const OPERATORS = new Map([
  ['AND', 'AND'],
  ['and', 'AND'],
  ['OR', 'OR'],
  ['or', 'OR'],
  ['WITH', 'WITH'],
  ['with', 'WITH'],
]);

/** @param {string} agentsMarkdown */
export function readAllowlist(agentsMarkdown) {
  const match = /^4\. \*\*Licenses\*\*[\s\S]*?Allowed:\s*([\s\S]*?)\.\s*$/m.exec(agentsMarkdown);
  const ids = match?.[1]?.split(',').map((id) => id.trim());
  if (!ids?.length || ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id))) {
    throw new Error('could not read the allowlist from AGENTS.md rule 4 ("Allowed: A, B, ….")');
  }
  return ids;
}

/** @param {string} expression */
function tokenize(expression) {
  return expression.replace(/[()]/g, ' $& ').trim().split(/\s+/);
}

/**
 * @param {string | undefined} expression
 * @param {readonly string[]} allowed
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function evaluateLicense(expression, allowed) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    return { allowed: false, reason: 'no license declared' };
  }
  const allowedIds = new Set(allowed.map((id) => id.toLowerCase()));
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const isOperator = (token, name) => OPERATORS.get(token) === name;

  /** @returns {{ ok: boolean, rejected: string[] }} */
  function parseOr() {
    let left = parseAnd();
    while (isOperator(peek(), 'OR')) {
      position++;
      const right = parseAnd();
      left = { ok: left.ok || right.ok, rejected: [...left.rejected, ...right.rejected] };
    }
    return left;
  }

  function parseAnd() {
    let left = parseWith();
    while (isOperator(peek(), 'AND')) {
      position++;
      const right = parseWith();
      left = { ok: left.ok && right.ok, rejected: [...left.rejected, ...right.rejected] };
    }
    return left;
  }

  function parseWith() {
    const license = parseAtom();
    if (isOperator(peek(), 'WITH')) {
      position++;
      readId();
    }
    return license;
  }

  function parseAtom() {
    if (peek() === '(') {
      position++;
      const inner = parseOr();
      if (peek() !== ')') throw new SyntaxError('missing )');
      position++;
      return inner;
    }
    const id = readId();
    return allowedIds.has(id.toLowerCase())
      ? { ok: true, rejected: [] }
      : { ok: false, rejected: [id] };
  }

  function readId() {
    const token = peek();
    if (token === undefined || token === '(' || token === ')' || OPERATORS.has(token)) {
      throw new SyntaxError(`expected a license id, found ${token ?? 'the end'}`);
    }
    if (!/^[A-Za-z0-9.:+-]+$/.test(token)) throw new SyntaxError(`invalid license id ${token}`);
    position++;
    return token;
  }

  let result;
  try {
    result = parseOr();
    if (position !== tokens.length) throw new SyntaxError(`unexpected ${peek()}`);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { allowed: false, reason: `not a valid SPDX expression (${error.message})` };
  }
  return result.ok
    ? { allowed: true }
    : { allowed: false, reason: `not on the allowlist: ${result.rejected.join(', ')}` };
}
