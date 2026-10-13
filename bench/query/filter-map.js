function query (data) {
  return data
    .filter(item => item.active && item.score > 50)
    .map(item => ({ id: item.id, name: item.name, zip: item.address.zip, score: item.score }))
}
