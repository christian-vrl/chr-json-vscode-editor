function query (data) {
  return { zero: data.zero, negated: data.list.map(n => -n), isMinusZero: Object.is(data.zero, -0) }
}
