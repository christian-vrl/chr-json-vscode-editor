function query (data) {
  return _.sumBy(data.orders, 'qty')
}
