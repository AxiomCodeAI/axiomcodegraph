// fixture: cjs/type-registry/type-categories.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (private members); ES2015 otherwise
//
// Port of java/type-registry/test-type-categories.java. Every
// js_type.typeCategory: CLASS, CONSTRUCTOR_FUNCTION, ANONYMOUS_CLASS,
// JSDOC_TYPEDEF, JSDOC_CALLBACK — and, just as importantly, the things that are
// NOT types.
//
// NO ANALOGUE — `interface`, `enum`, `record`, `@interface`, `final`, `sealed`,
// `permits`, package-private access, inner (non-static) classes and static
// nested classes. JavaScript has classes, constructor functions and comments.
// Nesting a class inside a class is not a type relationship; it is a static
// property holding a class, and that is covered in type-placement.js.
//
// The exclusion that matters most: an OBJECT LITERAL IS NOT A TYPE. The schema
// says so explicitly, because treating every object literal as a type is how a
// JavaScript fact base acquires 50,000 meaningless ones. Half this file is
// controls for that rule.

'use strict';

const EventEmitter = require('events').EventEmitter;

// --- CLASS ------------------------------------------------------------------------

class Plain {
  method() { return 1; }
}

class WithHeritage extends EventEmitter {
  constructor() { super(); }
}

class WithBuiltinHeritage extends Error {
  constructor(msg) { super(msg); this.name = 'WithBuiltinHeritage'; }
}

class WithEverything extends Plain {
  static staticField = 1;
  instanceField = 2;
  #privateField = 3;
  static { WithEverything.initialised = true; }
  constructor() { super(); this.own = 4; }
  get value() { return this.#privateField; }
  set value(v) { this.#privateField = v; }
  static factory() { return new WithEverything(); }
  *[Symbol.iterator]() { yield this.own; }
}

// A class extending a CALL — the mixin pattern. isComputedSuperclass is true and
// there is no name to record as the supertype.
const mixin = (Base) => class extends Base { mixed() { return true; } };
class Mixed extends mixin(Plain) { }

// A class extending a member expression, and one extending a require inline.
const registry = { Base: Plain };
class FromMember extends registry.Base { }
class FromRequire extends require('events').EventEmitter { }

// --- ANONYMOUS_CLASS -------------------------------------------------------------------

const anonymous = class { method() { return 1; } };
const namedExpression = class Inner { self() { return Inner; } };
const immediatelyInstantiated = new (class { constructor() { this.x = 1; } })();
const inArgument = [class { }, class { }];
const exportedAnonymous = module.exports.Anonymous = class { };

// --- CONSTRUCTOR_FUNCTION -----------------------------------------------------------------
//
// A type with no `class` keyword. The evidence is `new` at a call site and
// members on `.prototype`, both elsewhere in the file — see
// prototypes/constructor-function.js for the full treatment.

function Legacy(seed) { this.seed = seed; }
Legacy.prototype.method = function () { return this.seed; };
const legacyInstance = new Legacy(1);

// A function that is NEVER called with `new` and has no prototype members. It is
// a function, not a type, and nothing distinguishes its declaration from
// `Legacy`'s.
function notAType(x) { return x; }

// --- JSDOC_TYPEDEF and JSDOC_CALLBACK ---------------------------------------------------------

/**
 * @typedef {Object} Options
 * @property {number} timeout
 */

/**
 * @callback Listener
 * @param {string} event
 * @returns {void}
 */

// --- NOT types: the controls -------------------------------------------------------------------
//
// Every one of these is a value. A parser that mints a js_type row for any of
// them is the failure this section exists to catch.

const objectLiteral = { a: 1, method() { return 1; } };
const frozenObject = Object.freeze({ A: 1, B: 2 });
const nullPrototype = Object.create(null);
const arrayOfObjects = [{ a: 1 }, { a: 2 }];
const factory = () => ({ made: true });
const madeByFactory = factory();
const instanceOfBuiltin = new Map();
const boundFunction = notAType.bind(null);
const arrowFunction = () => 1;
const symbolValue = Symbol('not a type');
const namespaceObject = {
  Inner: class { },          // a class INSIDE a value — the class IS a type,
  helper() { return 1; }     // the object around it is not
};

// A function returning a class. The returned class is a type declared inside a
// function scope; the function is not.
function classFactory(seed) {
  return class Generated { constructor() { this.seed = seed; } };
}
const Generated = classFactory(1);

module.exports = {
  Plain, WithHeritage, WithBuiltinHeritage, WithEverything, Mixed,
  FromMember, FromRequire,
  anonymous, namedExpression, immediatelyInstantiated, inArgument,
  Legacy, legacyInstance, notAType,
  objectLiteral, frozenObject, nullPrototype, arrayOfObjects, factory,
  madeByFactory, instanceOfBuiltin, boundFunction, arrowFunction, symbolValue,
  namespaceObject, classFactory, Generated
};
