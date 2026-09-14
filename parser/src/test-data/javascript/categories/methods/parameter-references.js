// fixture: cjs/methods/parameter-references.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (object rest in a parameter pattern)
//
// DISCRIMINATORS FOR `js_expression.resolvedParameterLinkHash`, the column being
// appended because a reference naming a parameter currently reaches nothing —
// 137,960 references to a parameter of their own method, 15,382 more one scope up.
//
// The column is an FK to `js_method_parameter`, and the hard part is not finding
// the parameter: it is knowing WHEN NOT TO LINK. Every section below is a case
// where the obvious implementation — "an identifier whose name matches a
// parameter of an enclosing method" — produces a wrong link. Getting those right
// is what the column is worth; getting §1 right is table stakes.
//
// Written so each case fails independently: every binding has a distinct name,
// so a wrong link is attributable to one section rather than to the file.

'use strict';

// A module-level binding with the SAME NAME as a parameter below. A reference
// inside that function must reach the PARAMETER, not this.
const shadowedByParam = 'module-level';

// --- 1. the base case: a reference in the parameter's own body ------------------

function ownBody(direct) {
  return direct + direct.length;          // two references, one parameter
}

// --- 2. a closure reference one scope up ------------------------------------------
//
// `captured` is never referenced in `outerFn`'s own body. The only references
// are inside `innerFn`, whose own method row is a different one — so the link
// crosses a method boundary and `enclosingMethodLinkHash` is not the owner.

function outerFn(captured) {
  function innerFn() {
    return captured;
  }
  return innerFn;
}

// --- 3. referenced ONLY inside a nested arrow -------------------------------------
//
// Same as §2 with an arrow, which has no `this` and no `arguments` of its own but
// closes over parameters identically. Three boundaries deep, so a walker that
// stops at the first function boundary reaches none of them.

function arrowOnly(deep) {
  return () => () => () => deep;
}

// --- 4. SHADOWING — the cases that must NOT link to the parameter -------------------

// 4a. A block-scoped local of the same name. Legal, and the inner reference
//     resolves to the LOCAL. Linking it to the parameter is the defect.
function blockShadow(name) {
  const before = name;                     // -> the PARAMETER
  {
    const name = 'block-local';
    const inside = name;                   // -> the LOCAL, not the parameter
    return [before, inside];
  }
}

// 4b. A nested function whose own parameter shadows the outer one. Both are
//     parameters, of different methods, and the inner reference takes the inner.
function paramShadow(value) {
  const outerRead = value;                 // -> paramShadow's parameter
  function inner(value) {
    return value;                          // -> inner's parameter
  }
  return [outerRead, inner('x')];
}

// 4c. A catch parameter shadowing a function parameter.
function catchShadow(err) {
  try {
    throw new Error('x');
  } catch (err) {
    return err.message;                    // -> the CATCH parameter
  }
}

// 4d. THE INVERSE, and the one most likely to be got wrong the other way: a
//     `var` of the same name as a parameter is NOT a new binding. It is the
//     SAME binding, redeclared, so both references link to the PARAMETER and no
//     js_variable should compete for them.
function varRedeclaration(same) {
  var same = same || 'defaulted';
  return same;                             // -> the PARAMETER, still
}

// 4e. A parameter shadowing a module-level const of the same name.
function shadowsModuleBinding(shadowedByParam) {
  return shadowedByParam;                  // -> the PARAMETER, not the module const
}

// --- 5. binding shapes: each is a different row shape ---------------------------------

// 5a. Defaulted. The reference is to an ASSIGNMENT_PATTERN parameter.
function defaulted(withDefault = 10) {
  return withDefault;
}

// 5b. A parameter referenced from inside ANOTHER parameter's default. The
//     parameter list is its own scope, evaluated left to right, so `first` here
//     is a reference to a parameter from a position that is not the body.
function defaultReferencesEarlier(first, second = first + 1) {
  return second;
}

// 5c. Rest. One parameter, `isRest`, and the reference is to the array it binds.
function rested(...restArgs) {
  return restArgs.length;
}

// 5d. OBJECT_PATTERN. CORRECTED 2026-09-12: I previously wrote that this mints
//     "one parameter row plus N js_variable rows". It does not. `emitVariables()`
//     skips every PARAMETER-regime binding, so **no parameter mints a
//     js_variable row at all** — simple or destructured. Verified:
//     `js_variable.bindingRegime = PARAMETER` counts **0** corpus-wide. The
//     schema's §3.5 said otherwise and the emitter was right.
//
//     So the bound names exist in the fact base ONLY as references, and
//     `resolvedParameterLinkHash` is identical for `alpha` and `beta` because
//     they resolve to the same pattern row. That gap is now RULED: a
//     binding-path column is being appended to the reference row.
//     `cjs/methods/pattern-binding-paths.js` carries the discriminators for it.
function objectPattern({ alpha, beta: renamedBeta, gamma = 3, ...restProps }) {
  return alpha + renamedBeta + gamma + Object.keys(restProps).length;
}

// 5e. ARRAY_PATTERN, including a hole and a nested pattern.
function arrayPattern([firstEl, , thirdEl, [nestedEl] = []]) {
  return firstEl + thirdEl + nestedEl;
}

// 5f. A destructured parameter referenced only from a nested closure — §2 and
//     §5d compounded, which is the shape a View hook callback takes.
function patternInClosure({ handler }) {
  return () => handler();
}

// --- 6. things that must link to NOTHING ------------------------------------------------

// 6a. `arguments` is the second parameter channel and it is not a parameter.
//     There is no declaration for it anywhere.
function usesArguments() {
  return arguments.length;
}

// 6b. A free identifier that merely SHARES A NAME with a parameter of a
//     DIFFERENT, unrelated function. Scope does not reach across siblings.
function sibling(unique) { return unique; }
function notSibling() {
  try { return unique; } catch (e) { return null; }   // -> nothing; ReferenceError
}

// 6c. A property whose name matches a parameter. `obj.direct` is a property
//     access, not a reference to `direct` — a matcher keyed on the identifier
//     text links it wrongly.
function propertyNotParameter(direct, obj) {
  return obj.direct + obj['direct'] + direct;
}

// 6d. An object-literal KEY matching a parameter name, and a shorthand beside it
//     — the shorthand IS a reference and the key is not.
function shorthandVsKey(key) {
  return { key: 'a literal key, not a reference', other: key };
}

// 6e. A class method's parameter, and the class field initialiser above it that
//     cannot see it.
class WithMethodParams {
  constructor(seed) {
    this.seed = seed;                       // -> the constructor's parameter
  }
  method(local) {
    return local + this.seed;               // `local` -> the method's parameter
  }
  static staticMethod(statParam) {
    return statParam;
  }
}

module.exports = {
  ownBody, outerFn, arrowOnly, blockShadow, paramShadow, catchShadow,
  varRedeclaration, shadowsModuleBinding, defaulted, defaultReferencesEarlier,
  rested, objectPattern, arrayPattern, patternInClosure, usesArguments,
  sibling, notSibling, propertyNotParameter, shorthandVsKey, WithMethodParams,
  shadowedByParam
};
