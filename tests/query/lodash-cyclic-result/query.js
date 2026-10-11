function query (data) {
  const list = _.clone(data)
  list.push(list)
  return list
}
