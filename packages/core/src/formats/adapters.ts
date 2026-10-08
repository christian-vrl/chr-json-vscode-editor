import { json5Adapter } from './json5-adapter.js';
import { jsonAdapter, jsoncAdapter } from './jsonc-adapter.js';
import type { Format, FormatAdapter } from './types.js';

/** The adapter for a format. */
export function getAdapter(format: Format): FormatAdapter {
  switch (format) {
    case 'json':
      return jsonAdapter;
    case 'jsonc':
      return jsoncAdapter;
    case 'json5':
      return json5Adapter;
  }
}
