// fixture: cjs/local-variables/local-variable-forms.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (object rest/spread); the `static {}` block in Holder is
//   ES2022 and is the file's only above-baseline line.
//
// Port of java/local-variables/LocalVariableExamples.java. Every js_variable
// bindingForm and every position a binding can occupy.
//
// JAVA CORRESPONDENCE, with the false friends pinned. Java's `final` local is
// closest to `const` — but `const` freezes the BINDING and not the value, and
// Java's `final` does the same, so the two actually agree. Java's `var` is
// closest to an un-annotated `let`, and the false friend is the KEYWORD: Java's
// `var` is block-scoped type inference, JavaScript's is function-scoped and
// hoisted. Destructuring has no Java form at all.
//
// The hoisting behaviour of `var` is in hoisting/var-hoisting.js; this file is
// about the declaration FORMS.

'use strict';

// --- the three keywords, and every declarator shape ---------------------------------

var v = 1;
let l = 2;
const c = 3;

// Multiple declarators in one statement — N variable rows, one statement.
let first = 1, second = 2, third;
const a = 1, b = 2;
var x, y, z;

// No initialiser. hasInitializer = false, and for `let` the TDZ ends here anyway.
let uninitialised;
var alsoUninitialised;

// --- object destructuring -----------------------------------------------------------

const source = { p: 1, q: 2, r: { s: 3, t: [4, 5] }, u: undefined };

const { p } = source;
const { p: renamed } = source;
const { u: withDefault = 'fallback' } = source;
const { missing: renamedWithDefault = 'both' } = source;
const { r: { s, t: [firstElement, secondElement] } } = source;    // nested, two levels
const { p: alsoP, ...restProps } = source;                        // rest
const { ['computed' in source ? 'p' : 'q']: computedKey } = source;
const { 'quoted key': quotedKey = null } = { 'quoted key': 1 };
const { 0: numericKey = null } = ['zeroth'];

// A destructuring whose source is a call.
const { length } = Object.keys(source);

// --- array destructuring ------------------------------------------------------------

const list = [1, 2, 3, 4];
const [one] = list;
const [, secondOnly] = list;                    // a hole in the pattern
const [head, ...tail] = list;
const [d = 10, e = 20] = [undefined];           // defaults for missing elements
const [[nestedFirst], [nestedSecond]] = [[1], [2]];
const [swapA, swapB] = [1, 2];
const [fromString] = 'abc';                     // any iterable, not just arrays
const [fromSet] = new Set([9]);

// --- bindings in every declaration position ----------------------------------------------

class Holder {
  constructor(seed) {
    // A binding in a constructor body, and a field assignment beside it.
    const inConstructor = seed * 2;
    this.value = inConstructor;
  }

  method() {
    let inMethod = 1;
    return inMethod;
  }

  get accessor() {
    const inGetter = this.value;
    return inGetter;
  }

  set accessor(next) {
    const inSetter = next;
    this.value = inSetter;
  }

  static staticMethod() {
    const inStatic = 1;
    return inStatic;
  }

  static {
    const inStaticBlock = 1;         // [ES2022] static initialisation block
    Holder.initialised = inStaticBlock;
  }
}

function* generatorLocals() {
  const beforeYield = 1;
  yield beforeYield;
  const afterYield = 2;      // declared after a suspension point
  return afterYield;
}

async function asyncLocals(promise) {
  const beforeAwait = 1;
  const awaited = await promise;
  return beforeAwait + awaited;
}

// Bindings in each loop head form, in a catch clause, and in a switch case.
function loopAndClauseBindings(items, obj) {
  const out = [];
  for (let i = 0; i < 1; i += 1) { out.push(i); }
  for (const item of items) { out.push(item); }
  for (const key in obj) { out.push(key); }
  for (const { p: destructuredInHead } of items) { out.push(destructuredInHead); }
  try { throw new Error('x'); } catch (caught) { out.push(caught.message); }
  switch (items.length) {
    case 0: {
      const inCase = 'empty';
      out.push(inCase);
      break;
    }
    default: {
      const inDefault = 'some';
      out.push(inDefault);
    }
  }
  return out;
}

// --- closure capture and shadowing --------------------------------------------------------

const shadowMe = 'module';
function shadowing(shadowMe) {              // parameter shadows the module const
  const inner = () => {
    const shadowMe = 'innermost';           // shadows the parameter
    return shadowMe;
  };
  {
    const shadowMe = 'block';               // shadows the parameter again
    return [shadowMe, inner()];
  }
}

function capturing(seed) {
  const captured = seed;
  let mutable = seed;
  return {
    read: () => captured,
    readMutable: () => mutable,
    write: (next) => { mutable = next; }
  };
}

// A local CLASS and a local FUNCTION — declarations that are also bindings, with
// different regimes (CLASS_TDZ vs FUNCTION_DECLARATION_HOISTED).
function localDeclarations(seed) {
  class LocalClass { constructor() { this.seed = seed; } }
  function localFunction() { return seed; }
  const LocalExpression = class { };
  return [new LocalClass(), localFunction(), new LocalExpression()];
}

// Initialisers of every expression kind, so initializerKind has one of each:
// NONE, REQUIRE_CALL, FUNCTION, CLASS, OBJECT_LITERAL, OTHER.
const initNone = undefined;
const initRequire = require('node:path');
const initFunction = function () { return 1; };
const initArrow = () => 1;
const initClass = class Named { };
const initObject = { k: 1 };
const initArray = [1];
const initCall = Object.keys({});
const initTemplate = `t`;
const initTernary = v ? 1 : 2;
const initAwaitless = Promise.resolve(1);
const initNew = new Map();

module.exports = {
  v, l, c, first, second, third, a, b, x, y, z,
  uninitialised, alsoUninitialised,
  p, renamed, withDefault, renamedWithDefault, s, firstElement, secondElement,
  alsoP, restProps, computedKey, quotedKey, numericKey, length,
  one, secondOnly, head, tail, d, e, nestedFirst, nestedSecond, swapA, swapB,
  fromString, fromSet,
  Holder, generatorLocals, asyncLocals, loopAndClauseBindings,
  shadowing, capturing, localDeclarations,
  initNone, initRequire, initFunction, initArrow, initClass, initObject,
  initArray, initCall, initTemplate, initTernary, initAwaitless, initNew
};
