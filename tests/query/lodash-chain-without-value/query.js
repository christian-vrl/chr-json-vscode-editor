function query (data) {
  return _.chain(data)
    .filter(person => person.age > 30)
    .map('name')
}
