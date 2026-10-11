class Fmt {
  constructor(v) { this.v = v }
  render() { return '[' + this.parse(this.v) + ']' }
  parse(v) { return String(v) }
}

function extend(plugin) { plugin(Fmt) }

function later(value, done) {
  setTimeout(() => done(value), 0)
}

module.exports = { Fmt, extend, later }
