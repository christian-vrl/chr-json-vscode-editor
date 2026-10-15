// Format core (spec 002).
export * from './types.js';
export { detectStyle, indentUnit } from './style.js';
export { stringify } from './stringify.js';
export { jsonAdapter, jsoncAdapter } from './jsonc-adapter.js';
export { json5Adapter } from './json5-adapter.js';
export { jsonlAdapter, readLines, type LinesData } from './jsonl-adapter.js';
export { getAdapter } from './adapters.js';
export { cachedParseTexts, releaseParse } from './cache.js';
export { parseData, type ParseDataResult } from './parse-data.js';
export { convert, ConvertError } from './convert.js';
export {
  smartFormat,
  SMART_FORMAT_MAX_LINE_LENGTH,
  type SmartFormatFormat,
  type SmartFormatOptions,
} from './smart-format.js';
export type { ConversionLoss, ConvertResult } from './convert.js';
export {
  bigNumberKey,
  compareNumbers,
  equalNumbers,
  holdsBigNumber,
  jsonText,
  LosslessNumber,
  mayHoldBigNumber,
  nearestNumbers,
  numberValue,
  readJsonExact,
  valueText,
} from './numbers.js';
