'use strict';
// ── how a value reaches a callee: conditionals, logical ops, reassignment, sequence, nesting ──
function a() { return 'a'; }
function b() { return 'b'; }
function c() { return 'c'; }
const base = { m() { return 'base.m'; }, n() { return 'base.n'; } };

function ternary(cond) { const f = cond ? a : b; return f(); }
function logicalOr(x) { const f = x || b; return f(); }
function nullish(x) { const f = x ?? c; return f(); }
function logicalAnd(x) { return (x && a)(); }
function reassigned(cond) { let f; if (cond) { f = a; } else { f = b; } return f(); }
function reassignedTwice() { let f = a; f = b; return f(); }
function sequence() { return (0, base.m)(); }
function paren() { return (base).m(); }
function nestedObject() {
  const cfg = { handlers: { onStart: null }, deep: { deeper: { deepest: { fn: c } } } };
  cfg.handlers.onStart = a;
  cfg.handlers.onStart();
  return cfg.deep.deeper.deepest.fn();
}
function spreadLiteral() { const o = { ...base, extra() { return 'x'; } }; o.m(); return o.extra(); }
function assignedCopy() { const o = Object.assign({}, base); return o.m(); }
function frozen() { const o = Object.freeze({ m: a }); return o.m(); }
function defined() {
  const o = {};
  Object.defineProperty(o, 'm', { value: b });
  Object.defineProperties(o, { n: { value: c } });
  return o.m() + o.n();
}
function arrays() {
  const steps = [a, b];
  steps[0](); steps[1]();
  const [x, y] = [a, c]; x(); y();
  const [first, ...others] = [b, c, a]; first(); others[0]();
  return steps.length;
}
function destructure() {
  const o = { inner: { deep: a }, cb: b };
  const { inner: { deep }, cb } = o; deep(); cb();
  const { missing = c } = {}; missing();
  const { cb: renamed } = o; renamed();
  const { ...rest } = o; rest.cb();
  return 0;
}
function factory() { return { run() { return 'ran'; }, self() { return this; } }; }
function closures() {
  factory().run();
  factory().self().run();
  const made = factory(); made.run();
  return 0;
}
const curried = (x) => (y) => (z) => x + y + z;
function currying() { return curried(1)(2)(3); }
function optional(o, cb) { o?.m(); o.m?.(); cb?.(); return o?.n?.(); }
function makeCounter() { let n = 0; return { inc: () => ++n, get: function () { return n; } }; }
function counters() { const k = makeCounter(); k.inc(); return k.get(); }
function returnsFn() { return a; }
function callsReturned() { returnsFn()(); return (returnsFn())(); }
function conditionalCall(flag) { return (flag ? base : { m: c }).m(); }
function withArgs() { return [1, 2].map(a); }
function hof(f) { return f(); }
function hofs() { hof(a); hof(() => b()); return hof(function named() { return c(); }); }
module.exports = { a, b, c, base, ternary, logicalOr, nullish, logicalAnd, reassigned, reassignedTwice, sequence, paren, nestedObject,
  spreadLiteral, assignedCopy, frozen, defined, arrays, destructure, closures, currying, optional, counters, callsReturned, conditionalCall, withArgs, hofs, factory };
