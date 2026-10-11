function query (data) {
  // Integer-like keys come first in any JavaScript object; the others keep insertion order.
  return { z: data.b, ...data, 10: 'ten', 2: 'two' }
}
