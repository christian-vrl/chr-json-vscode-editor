function query (data) {
  return _.map(data, n => BigInt(n) * 2n)
}
