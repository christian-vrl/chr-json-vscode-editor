function query (data) {
  return data
    .slice()
    .sort((a, b) => {
      // sort ascending
      const valueA = a?.address?.zip
      const valueB = b?.address?.zip
      return valueA > valueB ? 1 : valueA < valueB ? -1 : 0
    })
}
