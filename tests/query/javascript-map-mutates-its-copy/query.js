function query (data) {
  // Q1: the query owns its copy, so changing it in place is allowed.
  data.list.sort()
  data.list.push(data.list.length + 1)
  delete data.extra
  return data
}
