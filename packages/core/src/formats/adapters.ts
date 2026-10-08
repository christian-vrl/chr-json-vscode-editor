import { jsonAdapter, jsoncAdapter } from './jsonc-adapter.js';
import type { Format, FormatAdapter } from './types.js';

/** The adapter for a format. JSON5 has none until 002 T5 (ADR-009). */
export function getAdapter(format: Format): FormatAdapter {
  switch (format) {
    case 'json':
      return jsonAdapter;
    case 'jsonc':
      return jsoncAdapter;
    case 'json5':
      throw new Error('no JSON5 adapter yet (002 T5)');
  }
}
