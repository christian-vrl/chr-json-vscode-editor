function query (data) {
  return { min: _.min(data), max: _.max(data), sorted: _.sortBy(data) }
}
