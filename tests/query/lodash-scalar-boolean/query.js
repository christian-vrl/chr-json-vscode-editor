function query (data) {
  return _.some(data.orders, { item: 'book' })
}
