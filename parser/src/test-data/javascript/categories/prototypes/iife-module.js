// fixture: cjs/prototypes/iife-module.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5 (deliberately — this is what the pattern looks like in the
//   wild, and the whole reason the pattern exists is that ES5 had no modules)
//
// The module pattern: a function invoked immediately so its body is a private
// scope, returning the public surface. Every "export" here is a property of a
// returned object literal, and every "private member" is a closure variable
// with no declaration outside the IIFE.
//
// Four things a parser has to get right, and each has bitten a real extractor:
//   1. callKind = IIFE_CALL, 113 sites measured. The callee is a function
//      EXPRESSION, so there is no name to resolve.
//   2. The worklist must descend into the IIFE body. It is a function boundary,
//      and everything interesting is behind it.
//   3. The parenthesisation produces no row of its own; a subtree rooted at a
//      non-emitting node dies before its children are enqueued, which in
//      TypeScript cost thousands of call sites twice.
//   4. Both spellings — `(function(){})()` and `(function(){}())` — are the same
//      construct with the parenthesis in a different place.
//
// Grounded in the UMD wrapper of every pre-ESM library and the pre-2015 `var Module = (function(){...})()`
// that every library shipped.

'use strict';

// --- the classic: parens outside the call ------------------------------------

var Counter = (function () {
  // Private state. No declaration is reachable from outside the IIFE, and it is
  // shared by every function returned below — one instance, not one per call.
  var count = 0;
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) { listeners[i](count); }
  }

  // The public surface, as an object literal.
  return {
    increment: function () { count += 1; notify(); return count; },
    reset: function () { count = 0; notify(); },
    onChange: function (fn) { listeners.push(fn); },
    get value() { return count; }
  };
})();

// --- the other spelling: parens around the whole call -------------------------

var Registry = (function () {
  var items = Object.create(null);
  return {
    put: function (k, v) { items[k] = v; return this; },
    get: function (k) { return items[k]; }
  };
}());

// --- the UMD head -------------------------------------------------------------
//
// A conditional module edge inside an IIFE, choosing between three module
// systems at runtime. All three branches are real; only one executes. This is
// the single most common file head in a pre-ESM npm package and it is a
// module-system decision made in EXPRESSION position.

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports'], factory);            // AMD
  } else if (typeof exports === 'object' && typeof module !== 'undefined') {
    factory(exports);                        // CommonJS
  } else {
    factory((root.fixtureUmd = {}));         // browser global
  }
}(typeof self !== 'undefined' ? self : this, function (exports) {
  exports.identity = function (x) { return x; };
  exports.noop = function () {};
}));

// --- IIFE with arguments -------------------------------------------------------
//
// The dependency-injection form. `undefined` is passed so the parameter name is
// guaranteed to hold the real undefined even in ES3 where the global was
// writable — which is why the parameter list is longer than the argument list.

var Sandbox = (function (global, $, undefined) {
  var VERSION = '1.0.0';
  function boot() { return global && $ ? VERSION : null; }
  return { boot: boot, VERSION: VERSION };
})(typeof globalThis !== 'undefined' ? globalThis : this, null);

// --- the alternative punctuations -----------------------------------------------
//
// A unary operator in front of a function expression makes it an expression,
// so no parentheses are needed at all. Same construct, and a matcher looking for
// a ParenthesizedExpression callee misses every one of them.

!function () { globalThis.__bangIife = true; }();
+function () { globalThis.__plusIife = true; }();
void function () { globalThis.__voidIife = true; }();

// --- a NAMED function expression, immediately invoked ---------------------------
//
// `factory` is in scope inside its own body and nowhere else, which is how the
// recursive form works.

var Tree = (function factory(depth) {
  if (depth === 0) { return null; }
  return { depth: depth, child: factory(depth - 1) };
})(3);

// --- an arrow IIFE, and an async one --------------------------------------------
//
// Same construct at the modern end. The arrow's `this` is lexical, so the
// dependency-injection trick above does not work with it.

var lexical = (() => ({ kind: 'arrow-iife' }))();
var pending = (async () => { return 1; })();

// --- the control: a function expression that is NOT invoked ----------------------
//
// Same shape, no call. Nothing here runs, and a matcher that keys on "function
// expression in parentheses" mints an IIFE row for it.

var notInvoked = (function () { return 'never runs'; });

module.exports = {
  Counter: Counter,
  Registry: Registry,
  Sandbox: Sandbox,
  Tree: Tree,
  lexical: lexical,
  pending: pending,
  notInvoked: notInvoked
};
