// The tracer's own regression fixture: the rewrite must not change what the program
// does. Each case asserts an invariant that INSTRUMENTATION could break, and the
// control beside it is the shape that was never at risk.
//
// Run it twice, uninstrumented and instrumented, and expect the same exit status.
const assert = require('node:assert/strict')

// ── the directive prologue ──────────────────────────────────────────────────
// `__ax.enter(n);` inserted after `{` pushes 'use strict' out of the prologue and
// the function silently stops being strict. `this` in a plain call is the tell:
// undefined under strict, the global object under sloppy.
function strictByDirective() {
  'use strict'
  return this
}
assert.equal(strictByDirective(), undefined, 'a function-level use-strict directive must survive')

// Two directives, and one that is not a directive because an expression precedes it.
function twoDirectives() {
  'use strict'
  'another directive'
  return this
}
assert.equal(twoDirectives(), undefined, 'the whole prologue must survive, not just its first line')

// CONTROL: no directive, so the function is sloppy and `this` is the global object.
// If the insertion point were computed wrongly this one would not change, which is
// exactly why the case above is the one that proves it.
function sloppy() {
  return this
}
assert.equal(sloppy(), globalThis, 'a function with no directive stays sloppy')

// CONTROL: a leading STRING EXPRESSION that is not a directive, because a template
// literal never is. The function is sloppy and the statement is kept.
function templateFirst() {
  ;`not a directive`
  return this
}
assert.equal(templateFirst(), globalThis, 'a template literal is not a directive')

// ── the call-site rewrite ───────────────────────────────────────────────────
// `f(a)` becomes `__ax.e(__ax.s(n), f(a))`, so the site expression is untouched and
// receiver binding, argument order and short-circuiting are what they were.
const receiver = {
  n: 7,
  get() {
    return this.n
  },
}
assert.equal(receiver.get(), 7, 'a method call keeps its receiver')

const order = []
const note = (x) => (order.push(x), x)
const sum = (a, b) => a + b
assert.equal(sum(note(1), note(2)), 3)
assert.deepEqual(order, [1, 2], 'arguments evaluate left to right')

const maybe = null
assert.equal(maybe?.missing().deeper(), undefined, 'an optional chain still short-circuits')

// A generator body runs at .next(), not at the call, and the instrumenter marks it
// non-consuming for that reason. What matters here is only that it still works.
function* counted() {
  yield 1
  yield 2
}
assert.deepEqual([...counted()], [1, 2], 'a generator still yields')

// An expression-bodied arrow becomes a block with a return; the value is unchanged.
const twice = (x) => x * 2
assert.equal(twice(21), 42, 'an expression-bodied arrow returns its expression')

// ── a realm the tracer is not in ────────────────────────────────────────────
// A rewritten file evaluated in a fresh V8 context has no `__ax` on its global. It
// must still run, and it must say once that it ran untraced rather than throw.
const vm = require('node:vm')
const fs = require('node:fs')
const realmSource = fs.readFileSync(require.resolve('./realm.js'), 'utf8')
const realm = vm.createContext({module: {exports: {}}, exports: {}, require, console, process})
vm.runInNewContext(realmSource, realm)
assert.equal(realm.module.exports.twice(4), 8, 'a rewritten file must run in a realm with no tracer')

console.log('selftest: ok')
