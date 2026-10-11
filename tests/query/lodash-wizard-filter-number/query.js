function query (data) {
  return _.chain(data)
    .filter(item => item?.age > 30)
    .value()
}
