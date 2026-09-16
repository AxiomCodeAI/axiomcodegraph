'use strict';
// `super.m` read as a VALUE (#716): forwarding to the base with the caller's own
// arguments, or capturing the base implementation before rebinding. The member of
// `super` is the base's member of that name, whatever is done with it afterwards.
function log() { return 1; }
class Base {
  defaultTo(v) { return log(); }
  render() { return log(); }
  merge(a) { return log(); }
}
class Child extends Base {
  defaultTo(v) { return super.defaultTo.apply(this, arguments); }
  render() { const f = super.render; return f.call(this); }
  bound() { return super.defaultTo.call(this, 1); }
  rebound() { const g = super.merge.bind(this); return g(2); }
  direct() { return super.render(); }
}
// Through an arrow inside a method: `super` is still the method's.
class Grand extends Base {
  go() { const run = () => super.render.apply(this); return run(); }
}
// A base without the member yields nothing, as the call form does.
class Plain {}
class Orphan extends Plain {
  nope() { return super.missing ? 1 : 2; }
}

function run() {
  const c = new Child();
  c.defaultTo(1); c.render(); c.bound(); c.rebound(); c.direct();
  new Grand().go(); new Orphan().nope();
}
module.exports = { run };
