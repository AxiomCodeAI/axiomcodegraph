'use strict';
function helper(x) { return x + 1; }
const arrow = (y) => helper(y) * 2;
class Base {
  constructor(n) { this.n = n; this.cb = () => this.greet(); }
  greet() { return 'hi ' + this.n; }
  static make(n) { return new Base(n); }
  get size() { return this.n; }
}
class Derived extends Base {
  constructor(n) { super(n); }
  greet() { return super.greet() + '!'; }
  shout() { return this.greet().toUpperCase(); }
}
function Legacy(v) { this.v = v; }
Legacy.prototype.value = function () { return this.v; };
Legacy.create = function (v) { return new Legacy(v); };
const obj = {
  m() { return helper(1); },
  f: function () { return arrow(2); },
  g: (z) => z,
};
module.exports = { helper, arrow, Base, Derived, Legacy, obj };
module.exports.extra = function extra() { return 42; };
exports.another = () => 7;
