function stamp(s) {
  return '[' + new Date(0).toISOString() + '] ' + s;
}

module.exports = { stamp };
