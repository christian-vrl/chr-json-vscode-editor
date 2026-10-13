// JSONPath (RFC 9535) as one more library query language (spec 014, 014 T2): json-p3 2.3.2 in its
// default strict environment, which interprets the query (no `eval`), so it runs in the page like
// the library's own JSONQuery, JMESPath and JSONPath (Goessner). The wizard's text is the library's
// JSONPath `createQuery`, which is already valid RFC 9535 (P7).
//
// APIs used, from json-p3@2.3.2 dist/json-p3.esm.js (declared in ./json-p3.d.ts, which the package
// does not ship): JSONPathEnvironment (:4468, `maxRecursionDepth` :4472, query :4494),
// JSONPathNodeList.values (:785), JSONPathRecursionLimitError (:128; thrown by `..` at :3647, :3669).
import { JSONPathEnvironment, JSONPathRecursionLimitError } from 'json-p3';
import { jsonpathQueryLanguage, type QueryLanguage } from 'vanilla-jsoneditor';

/** P6: deep enough for `..` on ordinary deep data; the engine's default of 50 is not. */
export const MAX_RECURSION_DEPTH = 1000;

/** P6's message, for data nested deeper than the limit or deeper than the page's stack. */
export const TOO_DEEP_MESSAGE = 'The data is nested too deeply for this query.';

const environment = new JSONPathEnvironment({ maxRecursionDepth: MAX_RECURSION_DEPTH });

/** A JavaScript stack overflow: V8 (Node, Chromium, the VS Code webview) throws this RangeError. */
const isStackOverflow = (error: unknown): boolean =>
  error instanceof RangeError && /call stack/i.test(error.message);

/**
 * The query's nodelist as an array of the data's own values, in nodelist order; `[]` when nothing
 * matches (P2). Engine errors keep their own message, position included (criterion 6), except
 * P6's, which become TOO_DEEP_MESSAGE.
 */
export function executeJsonpathRfc9535(data: unknown, query: string): unknown[] {
  try {
    return environment.query(query, data).values();
  } catch (error) {
    if (error instanceof JSONPathRecursionLimitError || isStackOverflow(error)) {
      throw new Error(TOO_DEEP_MESSAGE, { cause: error });
    }
    throw error;
  }
}

export const jsonpathRfc9535QueryLanguage: QueryLanguage = {
  id: 'jsonpath-rfc9535',
  name: 'JSONPath (RFC 9535)',
  description: `<p>
  Enter a <a href="https://www.rfc-editor.org/rfc/rfc9535" target="_blank"
  rel="noopener noreferrer">JSONPath (RFC 9535)</a> query, the IETF standard JSONPath, to select
  values from the data. Example query: <code>$[?@.age &gt;= 18].name</code>.
  JSONPath (Goessner) is the older syntax, with its own extensions.
</p>`,
  createQuery: jsonpathQueryLanguage.createQuery,
  executeQuery: (json, query) => executeJsonpathRfc9535(json, query),
};
