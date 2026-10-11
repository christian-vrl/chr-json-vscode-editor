function query (data) {
  return data.orders.map(order => ({ id: order.id, total: order.qty * order.price }))
}
