'use strict';
function run() { return 'module-run'; }
function helper() { return 'module-helper'; }
class X {
  static run() { return 'static-run'; }
  run() { return 'instance-run'; }
  static helper() { return 'static-helper'; }
  both() { return X.run() + this.run() + run() + helper() + X.helper(); }
  shadow(run) { return run(); }
  shadowLocal() { const helper = () => 'local'; return helper(); }
  inner() { function helper() { return 'inner'; } return helper(); }
  viaFnExpr(items) { return items.map(function (i) { return this.run(); }, this); }
  viaFnExprUnbound(items) { return items.map(function (i) { return typeof this === 'undefined' ? 'u' : 'b'; }); }
  viaArrow(items) { return items.map((i) => this.run()); }
  toString() { return 'x'; }
  builtins() { return this.toString() + this.hasOwnProperty('a') + this.constructor.name + Object.prototype.toString.call(this); }
}
class Y { run() { return 'y-run'; } }
class Z extends X { get run() { return () => 'z-getter-run'; } }
const literalKeys = { 'my-key': run, 1: helper, [`tpl`]: run, ['computed' + 1]: helper, 'quoted'() { return 'q'; } };
function keys() { return literalKeys['my-key']() + literalKeys[1]() + literalKeys.tpl() + literalKeys.computed1() + literalKeys.quoted() + literalKeys['quoted'](); }
function pick(flag) { return flag ? new X() : new Y(); }
function polymorphic(flag) { return pick(flag).run(); }
function passthrough(o) { return o; }
function identityFlow() { return passthrough(new X()).run() + passthrough(new Y()).run(); }
let mutable = run;
function rebind() { mutable = helper; }
function callMutable() { return mutable(); }
const registry = {};
registry.a = run; registry.a = helper;
function callRegistry() { return registry.a(); }
function withThisArg(items) { return items.forEach(function (i) { return this.run(); }, new Y()); }
function ctorName() { const x = new X(); return x.constructor.run(); }
function protoCall() { return X.prototype.run.call(new Y()); }
function nestedSameName() { const o = { run() { return 'o-run'; }, inner: { run() { return 'inner-run'; } } }; return o.run() + o.inner.run(); }
module.exports = { X, Y, Z, run, helper, keys, polymorphic, identityFlow, rebind, callMutable, callRegistry, withThisArg, ctorName, protoCall, nestedSameName };
