function query (data) {
  return _.chain(data)
    .filter(item => item.active && item.score > 50)
    .orderBy([item => item.address.zip, 'score'], ['asc', 'desc'])
    .map(item => _.pick(item, ['id', 'name', 'score']))
    .value()
}
