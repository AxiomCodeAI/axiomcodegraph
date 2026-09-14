// fixture: cjs/methods/method-kinds.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (private `#` members and static blocks are used and are
//   the only above-baseline syntax; every other form is ES2018 or lower)
//
// Port of java/methods/MethodKindsTest.java and AllMethodExamples.java. Every
// js_method.methodKind: FUNCTION_DECLARATION, FUNCTION_EXPRESSION, ARROW,
// CLASS_METHOD, CONSTRUCTOR, GETTER, SETTER, STATIC_BLOCK. MODULE_INITIALIZER is
// synthetic and owns this file's top-level statements; nothing declares it.
//
// NO ANALOGUE — `synchronized`, `native`, `strictfp`, `transient`, `volatile`,
// `final` methods, and Java's INSTANCE initialiser block. JavaScript has a
// static initialisation block and no instance one. Java interface `default` and
// `static` methods do not port: JavaScript has no interfaces at all, so the
// question does not arise. Java records have no analogue.
//
// The three columns with no analogue in any other front end are exercised
// throughout: `hoisting`, `thisBinding` and `usesArguments`.

'use strict';

// --- free functions -------------------------------------------------------------------

function declaration(a) { return a; }
async function asyncDeclaration(a) { return a; }
function* generatorDeclaration(a) { yield a; }
async function* asyncGeneratorDeclaration(a) { yield a; }

const expression = function (a) { return a; };
const namedExpression = function inner(a) { return inner.name + a; };
const asyncExpression = async function (a) { return a; };
const generatorExpression = function* (a) { yield a; };
const asyncGeneratorExpression = async function* (a) { yield a; };

const arrow = (a) => a;
const arrowNoParens = a => a;
const arrowNoParams = () => 1;
const arrowBlockBody = (a) => { return a; };
const asyncArrow = async (a) => a;
const arrowReturningArrow = (a) => (b) => a + b;      // two rows, one line

// A function that uses `arguments` and declares no parameters. usesArguments is
// the second parameter channel, and parameterCount is 0 for a callable that
// takes any number of arguments.
function variadicByArguments() {
  return Array.prototype.slice.call(arguments);
}

// An arrow has no `arguments` of its own, so this one reads the enclosing
// function's — the same token means two different bindings by callable kind.
function arrowSeesOuterArguments() {
  const inner = () => arguments.length;
  return inner();
}

// --- class members ------------------------------------------------------------------------

class Kinds extends Object {
  static registry = new Map();          // [ES2022] static field
  instanceField = 1;                    // [ES2022] instance field
  #privateField = 2;                    // [ES2022] private field
  static #privateStatic = 3;            // [ES2022] private static field

  static {                              // [ES2022] static initialisation block
    Kinds.registry.set('self', Kinds);
  }

  constructor(seed) {
    super();
    this.seed = seed;
  }

  instanceMethod(a) { return a + this.seed; }
  static staticMethod(a) { return a; }

  async asyncMethod() { return this.seed; }
  static async staticAsyncMethod() { return 1; }
  *generatorMethod() { yield this.seed; }
  async *asyncGeneratorMethod() { yield this.seed; }

  get value() { return this.seed; }
  set value(v) { this.seed = v; }
  static get zero() { return new Kinds(0); }
  static set zero(_v) { throw new Error('read only'); }

  #privateMethod() { return this.#privateField; }
  static #privateStaticMethod() { return Kinds.#privateStatic; }
  get #privateAccessor() { return this.#privateField; }
  callPrivate() { return this.#privateMethod() + this.#privateAccessor; }

  ['computed' + 'Method']() { return 'computed'; }
  static ['computed' + 'Static']() { return 'computed static'; }
  [Symbol.iterator]() { return [this.seed][Symbol.iterator](); }
  [Symbol.asyncIterator]() { return this.asyncGeneratorMethod(); }

  // An arrow held in a field: NOT a class method. It is a per-instance property
  // whose `this` is lexical, so it survives detachment, and its methodKind is
  // ARROW rather than CLASS_METHOD.
  boundHandler = () => this.seed;

  // A method whose name collides with a builtin's.
  toString() { return 'Kinds(' + this.seed + ')'; }
  valueOf() { return this.seed; }
  static [Symbol.hasInstance](x) { return typeof x === 'object'; }
}

// A class EXPRESSION, named and anonymous, and a class declared inside a
// function — three placements, three owner scopes.
const NamedClassExpression = class Inner {
  self() { return Inner; }
};
const AnonymousClassExpression = class {
  method() { return 1; }
};
function makesAClass(seed) {
  return class Local { constructor() { this.seed = seed; } };
}

// --- object-literal members ------------------------------------------------------------------
//
// Shorthand methods, accessors, generators and an arrow property. An object
// literal is a VALUE, not a type — so these methods have no owning js_type, and
// that is the case ownerTypeLinkHash = "" exists for.

const literal = {
  shorthand(a) { return a; },
  'quoted name'(a) { return a; },
  42(a) { return a; },
  async asyncShorthand() { return 1; },
  *generatorShorthand() { yield 1; },
  async *asyncGeneratorShorthand() { yield 1; },
  get accessor() { return 1; },
  set accessor(v) { this._v = v; },
  ['computed' + 'Shorthand']() { return 1; },
  [Symbol.toPrimitive](hint) { return hint === 'number' ? 1 : 'one'; },
  arrowProperty: () => 1,
  functionProperty: function named() { return 1; },
  nested: { deep() { return 1; } }
};

module.exports = {
  declaration, asyncDeclaration, generatorDeclaration, asyncGeneratorDeclaration,
  expression, namedExpression, asyncExpression, generatorExpression,
  asyncGeneratorExpression, arrow, arrowNoParens, arrowNoParams, arrowBlockBody,
  asyncArrow, arrowReturningArrow, variadicByArguments, arrowSeesOuterArguments,
  Kinds, NamedClassExpression, AnonymousClassExpression, makesAClass, literal
};
