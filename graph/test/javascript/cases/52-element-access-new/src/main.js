'use strict';
// `new reg['Ctor']()` — a construction whose callee is an element access with a
// literal key resolves through the receiver's member, as the call form and the
// dot form already do (#715). A key with no string value stays dynamic.
function log() { return 1; }
function Ctor() {}
Ctor.prototype.run = function () { return log(); };
class Klass { constructor() { this.n = 1; } tick() { return 2; } }

const reg = {};
reg.Ctor = Ctor;
reg['Other'] = Ctor;
reg.Klass = Klass;

function viaNewLiteralKey() { return new reg['Ctor']().run(); }
function viaNewDot() { return new reg.Ctor().run(); }
function viaVar() { const C = reg['Other']; return new C().run(); }
function viaCallLiteralKey() { return reg['Ctor'](); }
function viaNewClassKey() { return new reg['Klass']().tick(); }

// A key the analysis cannot pin down names nothing and stays declared-dynamic. The key
// has to come from outside: a parameter whose only call site passes a literal is resolved
// by parameter flow, and that is the engine working, not this rule.
function viaComputed(type) { return new reg[type]().run(); }

// The shape this appears in: a table of constructors built at runtime.
const TYPES = Object.create(null);
function DEF(type, ctor) { TYPES[type] = ctor; return ctor; }
DEF('Call', function Call() {});
function make() { return new TYPES['Call'](); }

// An array of constructors read by index.
const list = [Ctor];
function viaIndex() { return new list[0]().run(); }

function run() {
  viaNewLiteralKey(); viaNewDot(); viaVar(); viaCallLiteralKey(); viaNewClassKey();
  viaComputed(process.argv[2]); make(); viaIndex();
}
module.exports = { run };
