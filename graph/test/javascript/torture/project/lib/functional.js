'use strict';
// ── closures, currying, higher-order, IIFE, recursion, default/rest params, destructuring ──
function compose(f, g) { return function composed(x) { return f(g(x)); }; }
const curry = (fn) => (a) => (b) => fn(a, b);
function add(a, b) { return a + b; }
function inc(x) { return add(x, 1); }
function twice(x) { return add(x, x); }
const addOne = curry(add)(1);
const incTwice = compose(twice, inc);
function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
const fib = function fibonacci(n) { return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2); };
const counter = (function () {
  let n = 0;
  function bump() { n += 1; return n; }
  return { bump, reset() { n = 0; return bump(); } };
})();
function withDefault(cb = () => inc(0), { mapper = twice, tag } = {}) { return mapper(cb()) + (tag ? 1 : 0); }
function variadic(first, ...rest) { return rest.reduce((acc, f) => f(acc), first(0)); }
function applyAll(fns, v) { let out = v; for (const f of fns) out = f(out); return out; }
// #606: a pipeline assembled by concat / flat runs the CONCATENATED functions, not only the receiver's.
function pipeline(extra) { const steps = [inc].concat(extra, twice); return steps[steps.length - 1](steps[1](1)); }
function nested(groups) { const flat = [[inc], groups].flat(); return flat[flat.length - 1](2); }
function memo(fn) { const cache = new Map(); return (k) => { if (!cache.has(k)) cache.set(k, fn(k)); return cache.get(k); }; }
const slowSquare = memo((x) => twice(x) * x);
module.exports = { compose, curry, add, inc, twice, addOne, incTwice, fact, fib, counter, withDefault, variadic, applyAll, slowSquare, pipeline, nested };
