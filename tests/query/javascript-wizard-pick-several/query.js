function query (data) {
  return data
    .map(item => ({
      "name": item?.name,
      "zip": item?.address?.zip})
    )
}
