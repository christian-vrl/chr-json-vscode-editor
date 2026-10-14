function query (data) {
  return _.map(_.filter(data, d => typeof d.id === 'object'), d => d.id * 2n)
}
