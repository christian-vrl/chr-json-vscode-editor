function query (data) {
  return _.map(data, d => d.id - 1)
}
