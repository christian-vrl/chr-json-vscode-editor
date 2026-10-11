function query (data) {
  return data.map(person => person.name).join(', ')
}
