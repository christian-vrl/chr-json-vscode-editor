function query (data) {
  return { doubled: data.map(n => n * 2), parsed: Number('abc') }
}
