'use strict';
// A well-known symbol is a program-wide constant, so a member declared under it is the
// member a call under the identical key names (#722). The iteration protocol is how a
// class hands the rest of the program a stream: without this the producer half is
// unreachable, and the site claims to be a correct end.
function made() { return 7; }
class Bag {
  constructor() { this.items = [1, 2]; }
  [Symbol.iterator]() { return made(), this.items[Symbol.iterator](); }
  [Symbol.toPrimitive](hint) { return made(); }
  read() { return this[Symbol.iterator](); }
  prim() { return this[Symbol.toPrimitive]('number'); }
}
// A LOCAL symbol keeps its creation-site identity (#597) and still resolves.
const kRun = Symbol('run');
class Local {
  [kRun]() { return made(); }
  go() { return this[kRun](); }
}
// A computed key on Symbol itself names nothing: still dynamic, the guard #597 installed.
function viaComputed(b, x) { return b[Symbol[x]](); }

function run() {
  const b = new Bag();
  b.read(); b.prim(); new Local().go(); viaComputed(b, 'iterator');
  return [...b];
}
module.exports = { run };
