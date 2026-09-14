// fixture: cjs/call-forms/call-apply-bind.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (spread)
//
// The 1,048 call sites where THE RECEIVER IS AN ARGUMENT. callKind =
// FUNCTION_CALL_CALL / FUNCTION_CALL_APPLY / FUNCTION_CALL_BIND, and
// receiverPosition = FIRST_ARGUMENT. Without that column an engine reads
// `Function.prototype.call` as the target of every one of them and never sees
// the real receiver at all.
//
// .bind is the odd one: it does NOT invoke. It returns a new function, so the
// call site is a call to bind and the invocation happens somewhere else, maybe
// never, maybe many times.
//
// Grounded in a runtime's internal utilities, a utility library's `apply` helper, and the
// borrowed-method idiom (`Array.prototype.slice.call(arguments)`) that is in
// every file written before 2015.

'use strict';

function describe(prefix, suffix) {
  return prefix + (this && this.name) + suffix;
}

const target = { name: 'target' };
const other = { name: 'other' };

// --- .call: receiver first, arguments spread out --------------------------------

const viaCall = describe.call(target, '[', ']');
const viaCallNoArgs = describe.call(target);
const viaCallNull = describe.call(null, '<', '>');       // sloppy: global; strict: null

// --- .apply: receiver first, arguments as an ARRAY --------------------------------
//
// argumentCount at the call site is 2, and the callee's arity is whatever the
// array's length turns out to be. The count is not the arity.

const viaApply = describe.apply(target, ['(', ')']);
const args = ['{', '}'];
const viaApplyVariable = describe.apply(target, args);
const viaApplyArguments = (function () {
  return describe.apply(target, arguments);
})('«', '»');

// --- .bind: no invocation here ------------------------------------------------------

const boundToTarget = describe.bind(target);
const boundWithPrefix = describe.bind(target, '#');       // partial application
const laterA = boundToTarget('a', 'b');
const laterB = boundWithPrefix('!');

// Binding an already-bound function does not rebind the receiver; it only adds
// more leading arguments.
const doubleBound = boundWithPrefix.bind(other, '?');
const doubleResult = doubleBound();

// A bound function used as a constructor: `new` OVERRIDES the bound receiver,
// which is the one case where bind's guarantee does not hold.
function Point(x, y) { this.x = x; this.y = y; }
const BoundPoint = Point.bind(null, 1);
const point = new BoundPoint(2);

// --- borrowed methods ---------------------------------------------------------------
//
// The receiver is not an instance of the method's own type. The method comes
// from one prototype and is applied to something else entirely, which is
// structural typing enforced at runtime and invisible to any declared-type model.

function toArray() {
  return Array.prototype.slice.call(arguments);
}
const arrayLike = { 0: 'a', 1: 'b', length: 2 };
const sliced = Array.prototype.slice.call(arrayLike);
const joined = Array.prototype.join.call(arrayLike, '-');
const hasOwn = Object.prototype.hasOwnProperty.call(arrayLike, 'length');
const typeTag = Object.prototype.toString.call(arrayLike);
const maxOf = Math.max.apply(null, [1, 5, 3]);

// The uncurried form: .call itself borrowed via .bind. `uncurryThis` is in
// a runtime's internal utilities and in every polyfill library, and the callee here
// is three levels of indirection away from the function that eventually runs.
const uncurryThis = Function.prototype.call.bind(Function.prototype.call);
const uncurried = uncurryThis(describe, target, '<<', '>>');

const hasOwnFast = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
const fastCheck = hasOwnFast(arrayLike, '0');

// --- Reflect.apply: the same operation as a plain function call ---------------------
//
// No `.call` or `.apply` token anywhere; a matcher keyed on the member name
// misses it, and the receiver is still an argument.

const viaReflect = Reflect.apply(describe, target, ['R', 'R']);

// --- spread: the modern replacement for .apply ---------------------------------------
//
// `f(...args)` does what `f.apply(null, args)` did. hasSpreadArgument = true and
// the receiver is back in syntactic position, so the two spellings of one intent
// produce different call kinds.

const viaSpread = describe(...args);
const viaSpreadMethod = target.describe ? target.describe(...args) : null;

// --- super-method call, prototype era -------------------------------------------------
//
// Before `super`, calling a superclass method meant naming its prototype and
// passing the receiver. This is the same construct as the borrowed methods above
// and it means something completely different.

function Base() {}
Base.prototype.render = function () { return 'base'; };
function Derived() { Base.call(this); }
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.render = function () {
  return Base.prototype.render.call(this) + '+derived';
};

module.exports = {
  describe, viaCall, viaCallNoArgs, viaCallNull, viaApply, viaApplyVariable,
  viaApplyArguments, boundToTarget, boundWithPrefix, laterA, laterB,
  doubleResult, point, toArray, sliced, joined, hasOwn, typeTag, maxOf,
  uncurried, fastCheck, viaReflect, viaSpread, viaSpreadMethod, Derived
};
