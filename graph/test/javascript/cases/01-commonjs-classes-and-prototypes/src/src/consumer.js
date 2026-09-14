const run = require('./main');
const { Derived } = require('../lib/util');
/** @param {Derived} d */
function useD(d) { return d.shout(); }
class Local extends Derived {
  extraLocal() { return this.greet() + this.shout(); }
}
function go() {
  run();
  new Local(1).extraLocal();
  useD(new Derived(1));
  const fn = go;
  fn();
  const o = { inner() { return 1; } };
  o.inner();
  const holder = { fn: run };
  holder.fn();
}
go();
