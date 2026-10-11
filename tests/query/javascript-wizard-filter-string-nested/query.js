function query (data) {
  return data
    .filter(item => item?.address?.city == 'Porto')
}
