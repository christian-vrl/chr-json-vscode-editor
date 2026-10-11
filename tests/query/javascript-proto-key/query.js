function query (data) {
  return { keys: Object.keys(data), copy: { ...data, extra: 1 }, inherited: data.admin === undefined }
}
