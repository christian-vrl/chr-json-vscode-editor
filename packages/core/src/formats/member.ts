// How the parsers add an object member.

/**
 * Sets `key` on `object` as an own enumerable member, as `JSON.parse` does. A `__proto__` key is
 * defined rather than assigned, since assigning it would set the prototype and lose the member.
 * Every other key is assigned: the same property, and `defineProperty` on every member made large
 * documents parse much slower (spec 008 T1).
 */
export function setMember(object: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__')
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  else object[key] = value;
}
