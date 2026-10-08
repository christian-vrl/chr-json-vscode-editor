// RFC 6901 JSON Pointer.
import { PatchError } from './types.js';

/** The pointer's reference tokens, unescaped (`~1` → `/`, then `~0` → `~`). `''` is the root. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PatchError(`invalid JSON Pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split('/')
    .map((token) => {
      if (/~(?![01])/.test(token)) throw new PatchError(`invalid JSON Pointer "${pointer}"`);
      return token.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

/** An array index token: `0` or digits without a leading zero (RFC 6901 §4). */
export function parseIndex(token: string): number | undefined {
  return /^(0|[1-9][0-9]*)$/.test(token) ? Number(token) : undefined;
}
