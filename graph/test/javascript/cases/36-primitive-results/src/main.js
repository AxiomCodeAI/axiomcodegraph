'use strict';
function name() { return 'hi'; }
function count() { return 3; }
function flag() { return true; }
function combined(x) { return x ? 'a' : 'b'; }
function viaConcat(a, b) { return a + '-' + b; }
function viaArith(a, b) { return a * b; }
function viaCompare(a, b) { return a > b; }
function viaTypeof(x) { return typeof x; }
function viaNegate(x) { return !x; }
function viaMinus(n) { return -n; }
function stays(x) { return x || name; }
class Greeter {
  greet() { return 'hi'; }
  count() { return 3; }
  list() { return [1, 2]; }
  async load() { return 'x'; }
  shout() { return this.greet().toUpperCase(); }
  pad() { return this.count().toFixed(1); }
  join() { return this.list().join(','); }
  tmpl() { return `${this.greet()}`.trim(); }
  async loaded() { return (await this.load()).trim(); }
  settle() { return new Promise((resolve, reject) => { if (this.count()) resolve(1); else reject(new Error('x')); }); }
}
function main() {
  const g = new Greeter();
  g.shout(); g.pad(); g.join(); g.tmpl(); g.loaded(); g.settle();
  name().toUpperCase(); count().toFixed(2); flag().toString(); combined(1).trim();
  viaConcat('a', 'b').split('-'); viaArith(2, 3).toFixed(0); viaCompare(1, 2).toString();
  viaTypeof(1).toUpperCase(); viaNegate(0).valueOf(); viaMinus(1).toFixed(0);
  (name() + '!').trim(); (count() + 1).toFixed(0);
  stays(0)();
}
main();
