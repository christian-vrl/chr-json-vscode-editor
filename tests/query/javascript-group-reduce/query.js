function query (data) {
  return data.reduce((groups, person) => {
    (groups[person.city] ??= []).push(person.name)
    return groups
  }, {})
}
