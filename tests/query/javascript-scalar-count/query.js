function query (data) {
  return data.filter(person => person.city === 'Lisbon').length
}
