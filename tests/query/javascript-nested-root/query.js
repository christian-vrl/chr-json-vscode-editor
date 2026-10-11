function query (data) {
  return data.filter(order => order.item === 'pen').map(order => order.id)
}
