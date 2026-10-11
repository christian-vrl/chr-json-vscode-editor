function query (data) {
  return _.chain(data)
    .groupBy('age')
    .mapValues(group => _.map(group, 'name'))
    .value()
}
