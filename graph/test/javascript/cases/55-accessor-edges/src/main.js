'use strict';
// A property access whose member is a getter, and an assignment whose member is
// a setter, are edges to the accessor (#731), so what an accessor's body calls
// has a caller.
class Request {
  constructor() { this._raw = { url: '/a' }; this._n = 0; }
  get url() { return this.parse(this._raw.url); }
  set count(v) { this._n = this.clamp(v); }
  parse(u) { return 'parsed:' + u; }
  clamp(v) { return v < 0 ? 0 : v; }
}
class Sub extends Request {
  get url() { return 'sub:' + super.url; }
}
class Both {
  get size() { return this.measure(); }
  set size(v) { this.store(v); }
  measure() { return 1; }
  store(v) { return v; }
}
const obj = { get name() { return literalHelper(); } };
function literalHelper() { return 'n'; }

function drive() {
  const r = new Sub();
  const a = r.url;
  r.count = 5;
  const b = new Both();
  b.size = b.size + 1;
  b.size += 2;
  return a + obj.name + b;
}
// The control: a plain member read is not an accessor edge, and a write to a
// plain field is not a setter edge.
class Plain { constructor() { this.v = 1; } m() { return 2; } }
function plainDrive() { const p = new Plain(); p.v = 3; return p.v + p.m(); }
module.exports = { drive, plainDrive };
