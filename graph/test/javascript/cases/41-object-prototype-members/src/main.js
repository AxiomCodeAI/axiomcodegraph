// An Object.prototype member on a project value is the platform's (#686): the
// class declares no hasOwnProperty, so the call is an ambient terminal, not a
// declared unknown.
class SchemaType {
  constructor() { this.opts = { index: true }; this.getters = []; }
  has(name) { return this.hasOwnProperty(name) || this.opts.hasOwnProperty(name); }
  label() { return this.toString() + this.valueOf(); }
  static own(name) { return SchemaType.hasOwnProperty(name); }
  fromCtor(name) { return this.constructor.hasOwnProperty(name); }
}
// The control: a class that declares its own toString resolves to it, not the platform.
class Named extends SchemaType {
  toString() { return 'named'; }
  describe() { return this.toString() + this.hasOwnProperty('x'); }
}
// A function is an object too.
function helper() { return 1; }
function viaFunction() { return helper.hasOwnProperty('name') && helper.toString(); }
function run() {
  const s = new SchemaType(); s.has('x'); s.label(); SchemaType.own('y'); s.fromCtor('z');
  new Named().describe();
  viaFunction();
}
module.exports = { run };
