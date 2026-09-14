// fixture: cjs/hoisting/tdz.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The temporal dead zone. `let`, `const` and `class` bindings are created when
// their scope is entered and are UNINITIALISED until their declaration is
// evaluated; touching one in between throws ReferenceError. So the binding
// exists, is in scope, shadows an outer name of the same name — and cannot be
// read. hasTemporalDeadZone is the column, and bindingRegime distinguishes
// LET_BLOCK_TDZ / CONST_BLOCK_TDZ / CLASS_TDZ.
//
// The reason this is not bookkeeping: a name resolver that binds an identifier
// to the nearest declaration and stops there will happily resolve every
// reference in this file, including the ones that throw. Whether a read is legal
// is a property of the ORDER of evaluation, not of the scope chain.
//
// Every throwing read below is inside a function that is not called at load, so
// this file evaluates cleanly.

'use strict';

const outerName = 'module scope';

function shadowedButUnreadable() {
  // `outerName` here refers to the LOCAL const on the next line, not to the
  // module-scope one — the binding shadows from the top of the function body.
  // This line therefore throws, even though a name at module scope exists.
  const read = outerName;
  const outerName = 'function scope';
  return [read, outerName];
}

function letTdz() {
  const probe = typeof value;   // throws: typeof does NOT protect a TDZ binding,
                                // which is the difference from an undeclared name
  let value = 1;
  return [probe, value];
}

function constTdz() {
  return () => frozen;          // safe: the closure is not called until later
  const frozen = 1;             // eslint-disable-line no-unreachable
}

// A class binding is in a TDZ exactly as a `let` is. `new Early()` before the
// declaration throws; the same code with a constructor FUNCTION would work,
// because a function declaration hoists completely. That contrast is the whole
// content of function-decl-vs-expression.js.
function classTdz() {
  const made = new Early();
  class Early {}
  return made;
}

// A class EXPRESSION assigned to a const: the const is in a TDZ, and the class
// has no binding of its own outside the expression.
const Late = class Named {
  self() { return Named; }
};

// The loop TDZ. `let` in a for head creates a FRESH binding per iteration, and
// each iteration's binding is in a TDZ until that iteration's initialisation.
function perIterationBindings() {
  const fns = [];
  for (let i = 0; i < 3; i += 1) {
    fns.push(() => i);          // captures THIS iteration's `i`
  }
  return fns.map((f) => f());   // [0, 1, 2]
}

// Mutual TDZ: two consts referring to each other. The first is unreadable when
// the second is evaluated only if the order is wrong; here the functions defer
// both reads, so both work.
const a = () => b();
const b = () => 'b';

// const is not deep. The BINDING cannot be reassigned; the value can be mutated,
// and `isReassigned` on the variable is about the binding, not the object.
const mutable = { count: 0 };
mutable.count += 1;

// A `let` with no initialiser. It is initialised to undefined at its
// declaration, so the TDZ ends there even though nothing was assigned.
function uninitialisedLet() {
  let declaredNotAssigned;
  return typeof declaredNotAssigned;    // 'undefined', and no throw
}

// A catch parameter is its own binding regime — CATCH_PARAMETER — scoped to the
// catch block, and it shadows an outer name of the same name.
const err = 'module-level err';
function catchScope() {
  try {
    throw new Error('boom');
  } catch (err) {
    return err.message;                  // the parameter, not the module const
  }
}

// An optional catch binding declares nothing at all.
function catchNoBinding() {
  try {
    throw new Error('boom');
  } catch {
    return 'swallowed';
  }
}

module.exports = {
  shadowedButUnreadable, letTdz, constTdz, classTdz, Late,
  perIterationBindings, a, b, mutable, uninitialisedLet, err,
  catchScope, catchNoBinding
};
