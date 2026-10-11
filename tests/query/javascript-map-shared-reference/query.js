function query (data) {
  // The same object twice, without a cycle, is written twice.
  return { first: data, second: data, list: [data, data] }
}
