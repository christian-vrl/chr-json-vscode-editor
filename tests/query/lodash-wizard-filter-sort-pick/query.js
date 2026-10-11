function query (data) {
  return _.chain(data)
    .filter(item => item?.city != 'Porto')
    .orderBy(['name'], ['desc'])
    .map(item => ({
      "name": item?.name,
      "age": item?.age
    }))
    .value()
}
