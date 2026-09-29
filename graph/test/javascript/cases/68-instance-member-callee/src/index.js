// `this.x()` where no class declares `x`: the function is stored on the instance
// from outside, so the site is a value callee (#1709).
function alpha() { return 'a'; }
class External { run() { return this.hook(); } }
function wire(e, fn) { e.hook = fn; }
class Assigned {
  constructor(opts) { Object.assign(this, opts); }
  run() { return this.onReady(); }
}
class Stored {
  constructor(x) { this.x = x; }
  run() { return this.x(); }
}
// controls: a declared method resolves; a base the graph cannot see may declare it
class Declared {
  own() { return 1; }
  run() { return this.own(); }
}
const Base = require('some-unstaged-base');
class Sub extends Base { run() { return this.emit('x'); } }
// control: an Object.prototype member is the platform's, not a stored value
class Proto { run(k) { return this.hasOwnProperty(k); } }
module.exports = { alpha, External, wire, Assigned, Stored, Declared, Sub, Proto };
