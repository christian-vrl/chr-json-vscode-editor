function query (data) {
  return data
    .filter(item => item?.city != 'Porto')
    .slice()
    .sort((a, b) => {
      // sort descending
      const valueA = a?.name
      const valueB = b?.name
      return valueA > valueB ? -1 : valueA < valueB ? 1 : 0
    })
    .map(item => ({
      "name": item?.name,
      "age": item?.age})
    )
}
