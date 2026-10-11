function query (data) {
  return _.chain(data)
    .filter(item => item?.address?.city == 'Porto')
    .value()
}
