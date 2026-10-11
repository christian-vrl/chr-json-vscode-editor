function query (data) {
  return { days: data.map(ms => new Date(ms)), first: new Date(Date.UTC(2026, 9, 11, 18, 30)) }
}
