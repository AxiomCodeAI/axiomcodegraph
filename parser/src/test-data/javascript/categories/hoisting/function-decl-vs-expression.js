// fixture: cjs/hoisting/function-decl-vs-expression.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The same syntax category behaving differently by POSITION. js_method.hoisting
// is a column for this reason: 5,271 function declarations (HOISTED_FULLY) and
// 4,325 function expressions (NOT_HOISTED) in the schema's corpus, and telling
// them apart is a question about the node's parent, not about the node.
//
// A function declaration's name AND body are both available from the top of the
// enclosing scope. A function expression's binding follows its declaration's
// own rules — var (undefined until assigned) or let/const (TDZ).

'use strict';

// --- hoisted completely: callable before its own text -------------------------

const early = hoistedDeclaration();

function hoistedDeclaration() {
  return 'callable from line 18';
}

// --- not hoisted: the binding is, the value is not -----------------------------

// var: the name exists and holds undefined, so this is a TypeError ("not a
// function"), NOT a ReferenceError. The distinction says which half hoisted.
function varExpressionTooEarly() {
  const probe = typeof notYet;      // 'undefined'
  return notYet();                  // TypeError
  var notYet = function () { return 1; };  // eslint-disable-line no-unreachable
}

// const: the name is in a TDZ, so this is a ReferenceError. Same construct,
// different error, decided by one keyword.
function constExpressionTooEarly() {
  return alsoNotYet();              // ReferenceError
  const alsoNotYet = () => 1;       // eslint-disable-line no-unreachable
}

// --- the named function expression: two names, one of them private -------------
//
// `factorial` is bound INSIDE the function body only. Outside, the name is
// `fact`. Recursion through the inner name survives reassignment of the outer
// one, which is the reason the form exists.

const fact = function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
};
const factNameVisible = typeof factorial === 'undefined';

// --- a declaration inside a BLOCK ----------------------------------------------
//
// In strict mode (this file) a block-level function declaration is block-scoped
// and hoisted only within that block. In sloppy mode Annex B also creates a
// function-scoped `var` of the same name, so the SAME SOURCE binds differently
// depending on a directive — see sloppy-implicit-global.js for the other half.

function blockLevel() {
  if (true) {
    function inner() { return 'block scoped in strict mode'; }
    return inner();
  }
  return typeof inner;    // 'undefined' in strict mode
}

// --- a declaration inside a nested function, hoisted within it ------------------

function nestedHoisting() {
  const result = helper();
  function helper() { return 'hoisted inside nestedHoisting'; }
  return result;
}

// --- two declarations of the same name -------------------------------------------
//
// The LAST one wins, and both are hoisted, so the earlier one is unreachable
// from the moment the scope is entered. Two js_method rows describe one callable
// name, and only one of them can ever be the target of a call to `duplicated`.

function duplicated() { return 'first'; }
function duplicated() { return 'second'; }

// --- a declaration and a var of the same name --------------------------------------
//
// One binding. The function hoists into it, then the `var` declaration (which
// has no initialiser) leaves it alone — so `collides` is still the function.

function collides() { return 'function wins'; }
var collides;

// --- generators, async, and the class-body forms -----------------------------------
//
// A generator declaration hoists like any other declaration. A class does not:
// class declarations are in a TDZ. Same file, so the two are directly comparable.

const genEarly = typeof generatorDeclaration === 'function';
function* generatorDeclaration() { yield 1; }
async function asyncDeclaration() { return 1; }
async function* asyncGenDeclaration() { yield 1; }

// --- the arrow: never hoisted, never named by itself ---------------------------------

const arrow = (x) => x * 2;
const asyncArrow = async (x) => x * 2;

// --- function expressions in every non-declaration position ---------------------------
//
// Argument, property value, array element, return value, operand of a ternary,
// right side of a default. None hoists, all are NOT_HOISTED, and each sits under
// a different edgeRole in the expression tree.

const asArgument = [1, 2, 3].map(function double(n) { return n * 2; });
const asProperty = { handler: function () { return 'prop'; } };
const asElement = [function () { return 'elem'; }];
function returnsFunction() { return function returned() { return 'ret'; }; }
const asTernary = process.env.X ? function () { return 'a'; } : function () { return 'b'; };
function withDefault(fn = function () { return 'default fn'; }) { return fn(); }

module.exports = {
  early, hoistedDeclaration, varExpressionTooEarly, constExpressionTooEarly,
  fact, factNameVisible, blockLevel, nestedHoisting, duplicated, collides,
  genEarly, generatorDeclaration, asyncDeclaration, asyncGenDeclaration,
  arrow, asyncArrow, asArgument, asProperty, asElement, returnsFunction,
  asTernary, withDefault
};
