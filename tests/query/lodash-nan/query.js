function query (data) {
  return { mean: _.mean(data.scores), bonus: data.bonus, isNaN: _.isNaN(data.bonus) }
}
