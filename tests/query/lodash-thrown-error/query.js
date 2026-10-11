function query (data) {
  if (_.isEmpty(data)) throw new RangeError('Nothing to group')
  return _.groupBy(data, 'kind')
}
