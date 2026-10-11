function query (data) {
  return _.chain(data)
    .orderBy(['age'], ['desc'])
    .value()
}
