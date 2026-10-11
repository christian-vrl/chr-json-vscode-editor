function query (data) {
  return _.map(data, item => _.mapValues(item, value => _.isNumber(value) ? value * 10 : value))
}
