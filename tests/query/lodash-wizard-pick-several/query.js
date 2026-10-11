function query (data) {
  return _.chain(data)
    .map(item => ({
      "name": item?.name,
      "zip": item?.address?.zip
    }))
    .value()
}
