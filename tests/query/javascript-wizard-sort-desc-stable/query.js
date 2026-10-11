function query (data) {
  return data
    .slice()
    .sort((a, b) => {
      // sort descending
      const valueA = a?.age
      const valueB = b?.age
      return valueA > valueB ? -1 : valueA < valueB ? 1 : 0
    })
}
