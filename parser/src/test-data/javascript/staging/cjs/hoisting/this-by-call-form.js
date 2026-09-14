// fixture: cjs/hoisting/this-by-call-form.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// One function, six values of `this`, decided entirely by HOW IT IS CALLED. The
// function's own text is identical in every case. 33,189 `this` references in
// the schema's corpus, and js_method.thisBinding (LEXICAL | DYNAMIC | BOUND |
// NONE) is the column that says which regime a callable is in — but the VALUE is
// a property of the call site, not of the callable, which is why the two are
// separate facts.
//
// This is the clearest example in the language of a fact that syntax cannot
// decide. An engine that models `this` as "the receiver of the declaration" is
// wrong for five of the six forms below.

'use strict';

function whoAmI() {
  return this;
}

const obj = {
  name: 'obj',
  whoAmI,                                    // the SAME function object
  nested: { name: 'nested', whoAmI }
};

// 1. Bare call. In strict mode `this` is undefined; in sloppy mode it is
//    globalThis. The same line, two answers, decided by a directive.
const bare = whoAmI();

// 2. Method call. `this` is the receiver — and the receiver is whatever is to
//    the left of the dot at the CALL, not where the function was defined.
const asMethod = obj.whoAmI();
const asNested = obj.nested.whoAmI();

// 3. Detached. Taking the same function out of the object and calling it loses
//    the receiver entirely. This is the single most common `this` bug, and no
//    syntax at the assignment says anything is lost.
const detached = obj.whoAmI;
const detachedResult = detached();

// 4. .call / .apply — the receiver is an ARGUMENT. receiverPosition =
//    FIRST_ARGUMENT, and an engine reading the syntactic receiver gets
//    Function.prototype.call as the target and the real receiver not at all.
const viaCall = whoAmI.call(obj);
const viaApply = whoAmI.apply(obj, []);

// 5. .bind — produces a NEW function whose `this` is fixed. thisBinding = BOUND
//    on the result, and binding twice does NOT rebind: the first bind wins.
const bound = whoAmI.bind(obj);
const boundResult = bound();
const reboundResult = bound.call({ name: 'ignored' });   // still obj
const doubleBound = bound.bind({ name: 'also ignored' })();

// 6. As a constructor. `this` is a brand-new object whose prototype is
//    whoAmI.prototype, and the return value is discarded unless it is an object.
const constructed = new whoAmI();

// --- through a call form that hides the receiver -------------------------------

// Computed member call. The receiver is still `obj`; the method name is not
// fixed by syntax. callKind = COMPUTED_CALL.
const key = 'whoAmI';
const computed = obj[key]();

// Optional call. Same receiver rules; differs in reachability, not in target.
const optional = obj?.whoAmI?.();

// Through a call in an argument position — the receiver is lost the same way
// `detached` loses it, and this is why `arr.map(obj.method)` misbehaves.
const mapped = [1].map(obj.whoAmI);

// Tagged template. The tag is called with the receiver to its left, so `this`
// is obj here and undefined for a bare tag.
function tag(strings) { return this; }
const taggedBare = tag`x`;
const taggedMethod = { tag }.tag`x`;

// --- inside a constructor and a prototype method ----------------------------------

function Counter() {
  this.count = 0;

  // A nested plain function does NOT inherit the constructor's `this`. This is
  // the bug the `var self = this` line below exists to work around, and it is
  // the reason arrow functions were added.
  this.brokenIncrement = function () {
    return function () { return this; }();
  };

  const self = this;
  this.workingIncrement = function () {
    return function () { return self; }();
  };
}

Counter.prototype.method = function () { return this; };
Counter.prototype.callback = function () {
  return [1].map(function () { return this; });          // undefined per element
};
Counter.prototype.boundCallback = function () {
  return [1].map(function () { return this; }, this);    // thisArg parameter
};

// --- class bodies are always strict, even in a sloppy file --------------------------

class Modern {
  constructor() { this.kind = 'modern'; }
  method() { return this; }
  static staticMethod() { return this; }   // the CLASS, not an instance
}

const modern = new Modern();
const modernDetached = modern.method;

// --- module-level `this` in CommonJS --------------------------------------------------
//
// At the top level of a CommonJS module `this` is module.exports — not
// globalThis and not undefined. In an ES module it is undefined. Same token,
// three meanings, and only the module system decides.

const moduleThis = this;
const isExports = this === module.exports;

module.exports = {
  whoAmI, obj, bare, asMethod, asNested, detachedResult,
  viaCall, viaApply, boundResult, reboundResult, doubleBound, constructed,
  computed, optional, mapped, taggedBare, taggedMethod,
  Counter, Modern, modern, modernDetached, moduleThis, isExports
};
