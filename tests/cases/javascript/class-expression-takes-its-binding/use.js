const { Outer, Plain, registry, Alias, helper } = require('./lib');

function main() {
  const i = new Outer.Inner();
  const p = new Plain();
  const w = new registry.Widget();
  const a = new Alias();
  return i.ping() + p.go() + w.render() + a.hi() + helper();
}

module.exports = { main };
