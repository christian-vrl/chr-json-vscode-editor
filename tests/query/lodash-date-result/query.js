function query (data) {
  return _.mapValues(data, ms => new Date(ms))
}
