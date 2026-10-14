// Code evaluated inside the engine, never in the page (spec 011 plan §Constraints). Kept as plain
// ES2023 text so no build step rewrites it.

/** The error message the engine's half of the bridge throws, which runQuery maps to Q2's message. */
export const CYCLE_SENTINEL = '\u0000chr:cycle';

/**
 * The engine's half of the value bridge (Q2, plan steps 2 and 4), evaluated before any user code so
 * that it keeps the built-ins it uses (`JSON`, `Map`, `Object.defineProperty`, …) even if a query
 * replaces them. Its value is `{ input, output }`:
 * - `input(text, specials)` parses the page's JSON text (QuickJS's `JSON.parse` keeps `__proto__` as
 *   an own key) and puts each special number back at its path, and each big number as a
 *   `LosslessNumber` (below): a fresh copy of the data (Q1).
 * - `output(value)` writes the result with `JSON.stringify`'s rules (Q2: `toJSON`, dropped members,
 *   `null` in arrays, `undefined` → `null`), recording each special number's path through a
 *   replacer, and each `LosslessNumber`'s and `BigInt`'s path and digits (spec 015 B8); a value that
 *   contains itself throws a sentinel. Returns `[text, specials]`.
 *
 * A big number in the engine (spec 015 B8, UNK-066 ★ "Like the site") is lossless-json 4.3.1's
 * `LosslessNumber`, ported here line for line from its lib/esm/LosslessNumber.js and utils.js:
 * `isLosslessNumber`, `value` (its decimal text), `toString()` (the text), and `valueOf()` (a number
 * for a value a float holds or rounds a decimal of, a `BigInt` for an integer, else lossless-json's
 * overflow or underflow error). So `<`, `>`, `+` and Lodash's sorts use its value. An instance is
 * frozen, so a query can't change the digits it writes back; the class is reachable only as an
 * instance's `constructor`, and checks its argument as lossless-json's does.
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
  const freeze = Object.freeze;
  const parseFloat = Number.parseFloat;
  const isSafeInteger = Number.isSafeInteger;
  const isFinite = Number.isFinite;
  const BigIntFn = BigInt;
  const StringFn = String;
  const reTest = RegExp.prototype.test;
  const WeakSetCtor = WeakSet;
  const setAdd = WeakSet.prototype.add;
  const setHas = WeakSet.prototype.has;
  const values = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 };

  const INTEGER_REGEX = /^-?[0-9]+$/;
  const NUMBER_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  const isInteger = (value) => reTest.call(INTEGER_REGEX, value);
  function significantDigits(value) {
    let start = 0;
    if (value[0] === "-") start++;
    while (value[start] === "0" || value[start] === ".") start++;
    let end = value.lastIndexOf("e");
    if (end === -1) end = value.lastIndexOf("E");
    if (end === -1) end = value.length;
    while ((value[end - 1] === "0" || value[end - 1] === ".") && end > start) end--;
    let digits = "";
    for (let i = start; i < end; i++) if (value[i] !== ".") digits += value[i];
    return digits;
  }
  function isSafeNumber(value) {
    if (isInteger(value)) return isSafeInteger(parseFloat(value));
    const parsed = StringFn(parseFloat(value));
    return value === parsed || significantDigits(value) === significantDigits(parsed);
  }
  function unsafeReason(value) {
    if (isSafeNumber(value)) return undefined;
    if (isInteger(value)) return "truncate_integer";
    const num = parseFloat(value);
    if (!isFinite(num)) return "overflow";
    if (num === 0) return "underflow";
    return "truncate_float";
  }

  const bigNumbers = new WeakSetCtor();
  class LosslessNumber {
    constructor(value) {
      if (!reTest.call(NUMBER_REGEX, value)) throw new ErrorCtor('Invalid number (value: "' + value + '")');
      this.isLosslessNumber = true;
      this.value = value;
      freeze(this);
      setAdd.call(bigNumbers, this);
    }
    valueOf() {
      const reason = unsafeReason(this.value);
      if (reason === undefined || reason === "truncate_float") return parseFloat(this.value);
      if (isInteger(this.value)) return BigIntFn(this.value);
      throw new ErrorCtor("Cannot safely convert to number: the value '" + this.value + "' would " + reason + " and become " + parseFloat(this.value));
    }
    toString() {
      return this.value;
    }
  }

  function input(text, specialsText) {
    let root = parse(text);
    const specials = parse(specialsText);
    for (let s = 0; s < specials.length; s++) {
      const path = specials[s][0];
      const code = specials[s][1];
      const value = code === "big" ? new LosslessNumber(specials[s][2]) : values[code];
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
      if (type === "bigint") {
        specials[specials.length] = [pathTo(this, key), "big", StringFn(v)];
        return null;
      }
      if (v !== null && type === "object" && setHas.call(bigNumbers, v)) {
        specials[specials.length] = [pathTo(this, key), "big", v.value];
        return null;
      }
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
