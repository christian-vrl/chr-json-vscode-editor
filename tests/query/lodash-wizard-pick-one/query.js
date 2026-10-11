function query (data) {
  return _.chain(data)
    .map(item => item?.name)
    .value()
}
