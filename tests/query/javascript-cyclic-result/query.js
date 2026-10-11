function query (data) {
  const node = { data }
  node.data.parent = node
  return node
}
