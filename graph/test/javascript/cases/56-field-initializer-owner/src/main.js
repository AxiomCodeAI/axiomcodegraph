'use strict';
// A class field initializer is code that RUNS: at class evaluation for a static field,
// during construction for an instance one. It used to be owned by the module initializer,
// so `this` in it had no value and the call it makes was attributed to the module (#798).
function log() { return 1; }
class Base {
  static make(tag) { return log(); }
  make2() { return log(); }
}
class Child extends Base {
  static fromField = this.make('static');
  instField = this.make2();
  bound = this.make2.bind(this);
}
// A class that declares a constructor: the initializer still gets the class's own
// initialization callable, because a field written above the constructor would otherwise
// sit outside its owner's span.
class WithCtor extends Base {
  field = this.make2();
  constructor() { super(); this.n = 1; }
}
// A plain field runs nothing and needs no callable of its own.
class Plain { n = 1; label = 'x'; }

function drive() { return new Child().instField + new WithCtor().field + new Plain().n; }
module.exports = { drive };
