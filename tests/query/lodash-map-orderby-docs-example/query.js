function query (data) {
  // jsoneditoronline.org's documented Lodash example.
  data = _.orderBy(data, [['address', 'city']], ['asc'])
  return data
}
