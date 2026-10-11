function Thing(n) {
  this.n = n
}

Thing.prototype.twice = function twice() {
  return this.n * 2
}

module.exports = Thing
