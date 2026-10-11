function query (data) {
  return {
    a: data.a,
    f () { return 1 },
    u: undefined,
    s: Symbol('s'),
    list: [1, () => 2, undefined, Symbol('t')],
  }
}
