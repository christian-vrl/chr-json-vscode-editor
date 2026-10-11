function query (data) {
  return _.chain(data)
    .orderBy(['address.zip'], ['asc'])
    .value()
}
