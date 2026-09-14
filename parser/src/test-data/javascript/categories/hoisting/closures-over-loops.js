// fixture: cjs/hoisting/closures-over-loops.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// One loop, two keywords, two different programs. With `var` there is ONE binding
// and every closure sees its final value; with `let` there is one binding PER
// ITERATION and each closure sees its own. Nothing distinguishes the two loops
// except the keyword in the head, and the difference is not local to that head —
// it changes what every closure in the body captures.
//
// This is the case that makes js_scope a real relation rather than a flag. A
// binder that records "i is declared in the for statement" is right about both
// loops and useless for either.
//
// Grounded in the setTimeout-in-a-loop bug that is the most-asked question about
// JavaScript closures, and in the IIFE workaround every pre-ES2015 codebase used.

'use strict';

// --- var: one binding, shared -------------------------------------------------

function varLoop() {
  const fns = [];
  for (var i = 0; i < 3; i += 1) {
    fns.push(function () { return i; });
  }
  // i is 3 here — the binding outlived the loop — and every closure returns 3.
  return { after: i, values: fns.map((f) => f()) };
}

// --- let: one binding per iteration --------------------------------------------

function letLoop() {
  const fns = [];
  for (let i = 0; i < 3; i += 1) {
    fns.push(function () { return i; });
  }
  // i is not in scope here at all, and the closures return 0, 1, 2.
  return { values: fns.map((f) => f()) };
}

// --- the pre-ES2015 workaround --------------------------------------------------
//
// An IIFE per iteration, so the parameter is a fresh binding. Same effect as
// `let`, achieved with a function boundary — three extra scopes the binder has
// to build, and 3 extra call sites.

function iifeWorkaround() {
  const fns = [];
  for (var i = 0; i < 3; i += 1) {
    (function (captured) {
      fns.push(function () { return captured; });
    })(i);
  }
  return fns.map((f) => f());
}

// --- .bind as the other workaround ------------------------------------------------

function bindWorkaround() {
  const fns = [];
  for (var i = 0; i < 3; i += 1) {
    fns.push(function (captured) { return captured; }.bind(null, i));
  }
  return fns.map((f) => f());
}

// --- for-of and for-in --------------------------------------------------------------
//
// `const` in a for-of head is legal and gives a fresh binding each iteration.
// `var` in the same position gives one, exactly as above.

function forOfConst(items) {
  const fns = [];
  for (const item of items) { fns.push(() => item); }
  return fns.map((f) => f());
}

function forInVar(obj) {
  const fns = [];
  for (var key in obj) { fns.push(() => key); }
  return fns.map((f) => f());
}

// --- an async loop -----------------------------------------------------------------
//
// The captures resolve after the loop has finished, which is what makes the
// var/let difference observable rather than theoretical.

async function asyncCaptures() {
  const pending = [];
  for (var v = 0; v < 3; v += 1) { pending.push(Promise.resolve().then(() => v)); }
  for (let l = 0; l < 3; l += 1) { pending.push(Promise.resolve().then(() => l)); }
  return Promise.all(pending);   // [3,3,3, 0,1,2]
}

// --- capture in a nested loop, and a closure over BOTH counters -----------------------

function nestedCapture() {
  const fns = [];
  for (let outer = 0; outer < 2; outer += 1) {
    for (var inner = 0; inner < 2; inner += 1) {
      fns.push(() => [outer, inner]);
    }
  }
  return fns.map((f) => f());
}

// --- capture of a mutable let, mutated after the closure is made -------------------
//
// A closure captures the BINDING, not the value. `let` here is one binding for
// the whole function, so the mutation is visible.

function capturesBinding() {
  let value = 1;
  const read = () => value;
  value = 2;
  return read();   // 2
}

// --- a closure that WRITES to the captured binding -----------------------------------

function counterFactory() {
  let count = 0;
  return {
    increment() { count += 1; return count; },
    read() { return count; }
  };
}

module.exports = {
  varLoop, letLoop, iifeWorkaround, bindWorkaround, forOfConst, forInVar,
  asyncCaptures, nestedCapture, capturesBinding, counterFactory
};
