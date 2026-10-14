function query (data) {
  return data.filter(d => typeof d.id === 'object').map(d => d.id + 1n)
}
