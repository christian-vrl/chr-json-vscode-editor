function query (data) {
  return _.chain(data.orders)
    .map(order => _.pick(order, ['item', 'qty']))
    .uniqBy('item')
    .value()
}
