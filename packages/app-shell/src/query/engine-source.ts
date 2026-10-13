// Code evaluated inside the engine, never in the page (spec 011 plan §Constraints). Kept as plain
// ES2023 text so no build step rewrites it.

/** Error messages the engine's half of the bridge throws, which runQuery maps to Q2's messages. */
export const BIGINT_SENTINEL = '\u0000chr:bigint';
export const CYCLE_SENTINEL = '\u0000chr:cycle';

/**
 * The engine's half of the value bridge (Q2, plan steps 2 and 4), evaluated before any user code so
 * that it keeps the built-ins it uses (`JSON`, `Map`, `Object.defineProperty`, …) even if a query
 * replaces them. Its value is `{ input, output }`:
 * - `input(text, specials)` parses the page's JSON text (QuickJS's `JSON.parse` keeps `__proto__` as
 *   an own key) and puts each special number back at its path: a fresh copy of the data (Q1).
 * - `output(value)` writes the result with `JSON.stringify`'s rules (Q2: `toJSON`, dropped members,
 *   `null` in arrays, `undefined` → `null`), recording each special number's path through a
 *   replacer; a BigInt or a value that contains itself throws a sentinel. Returns `[text, specials]`.
 */
export const ENGINE_HELPERS = String.raw`(function () {
  "use strict";
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const define = Object.defineProperty;
  const is = Object.is;
  const MapCtor = Map;
  const mapGet = Map.prototype.get;
  const mapSet = Map.prototype.set;
  const TypeErrorCtor = TypeError;
  const ErrorCtor = Error;
  const values = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 };

  function input(text, specialsText) {
    let root = parse(text);
    const specials = parse(specialsText);
    for (let s = 0; s < specials.length; s++) {
      const path = specials[s][0];
      const value = values[specials[s][1]];
      if (path.length === 0) { root = value; continue; }
      let holder = root;
      for (let i = 0; i < path.length - 1; i++) holder = holder[path[i]];
      define(holder, path[path.length - 1], { value: value, writable: true, enumerable: true, configurable: true });
    }
    return root;
  }

  function output(value) {
    const links = new MapCtor();
    const specials = [];
    let rootHolder;
    function pathTo(holder, key) {
      if (holder === rootHolder) return [];
      const keys = [key];
      for (let link = mapGet.call(links, holder); link.holder !== rootHolder; link = mapGet.call(links, link.holder)) {
        keys[keys.length] = link.key;
      }
      const path = [];
      for (let i = keys.length - 1; i >= 0; i--) path[path.length] = keys[i];
      return path;
    }
    function replacer(key, v) {
      if (rootHolder === undefined) rootHolder = this;
      const type = typeof v;
      if (type === "bigint") throw new ErrorCtor(${JSON.stringify(BIGINT_SENTINEL)});
      if (type === "number") {
        let code;
        if (v !== v) code = "NaN";
        else if (v === Infinity) code = "Infinity";
        else if (v === -Infinity) code = "-Infinity";
        else if (is(v, -0)) code = "-0";
        if (code !== undefined) { specials[specials.length] = [pathTo(this, key), code]; return null; }
      } else if (v !== null && type === "object") {
        mapSet.call(links, v, { holder: this, key: key });
      }
      return v;
    }
    let text;
    try {
      text = stringify(value, replacer);
    } catch (error) {
      if (error instanceof TypeErrorCtor && /circular/i.test(error.message)) {
        throw new ErrorCtor(${JSON.stringify(CYCLE_SENTINEL)});
      }
      throw error;
    }
    return [text === undefined ? "null" : text, stringify(specials)];
  }

  return { input: input, output: output };
})()`;

/**
 * The library's own wrapper around the query text (vanilla-jsoneditor 3.13.0
 * `javascriptQueryLanguage.executeQuery`: `new Function('"use strict";\n\n' + query + …)`), as an
 * expression whose value is the `query` function. For Lodash the library passes `_` as the
 * function's parameter; here `_` is the engine's global (Q3), which the body sees the same way.
 */
export function wrapQuery(query: string): string {
  return (
    '(function () {\n"use strict";\n\n' +
    query +
    '\n\nif (typeof query !== "function") {\n' +
    '  throw new Error("Cannot execute query: expecting a function named \'query\' but is undefined")\n' +
    '}\n\nreturn query;\n})()'
  );
}
