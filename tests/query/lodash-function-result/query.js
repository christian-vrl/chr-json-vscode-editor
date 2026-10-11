function query (data) {
  return { values: data, noop: _.noop, steps: _.map(data, n => _.constant(n)), lodash: _ }
}
