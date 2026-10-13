// json-p3 2.3.2's package.json names `dist/index.d.ts` as its types, but the published package
// ships only dist/path/segments.d.ts, so the part this package uses is declared here (spec 014,
// 014 T2). Each declaration follows dist/json-p3.esm.js: JSONPathError and its subclasses (:31-139,
// a message with the position appended by withErrorContext, :41-52), JSONPathNodeList.values()
// (:785-787), JSONPathEnvironment's constructor options (:4468-4477) and query() (:4494-4496).
declare module 'json-p3' {
  export interface JSONPathEnvironmentOptions {
    /** Defaults to true: RFC 9535 only, no non-standard selectors. */
    strict?: boolean;
    /** How many arrays and objects deep `..` may go before it throws; defaults to 50. */
    maxRecursionDepth?: number;
    maxIntIndex?: number;
    minIntIndex?: number;
    nondeterministic?: boolean;
  }

  export class JSONPathNodeList {
    /** The value of each node, in nodelist order. */
    values(): unknown[];
  }

  export class JSONPathEnvironment {
    constructor(options?: JSONPathEnvironmentOptions);
    /** Parses and runs `path` on `value`; throws a JSONPathError on a bad query. */
    query(path: string, value: unknown): JSONPathNodeList;
  }

  export class JSONPathError extends Error {}
  export class JSONPathSyntaxError extends JSONPathError {}
  export class JSONPathTypeError extends JSONPathError {}
  export class JSONPathRecursionLimitError extends JSONPathError {}
}
