// fixture: cjs/methods/constructor-patterns.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (private constructor-guard field); ES2015 otherwise
//
// Port of java/methods/ConstructorPatterns.java. methodKind = CONSTRUCTOR, and
// the two eras side by side: the `constructor` method and the constructor
// FUNCTION, which is the same concept with no declaration syntax.
//
// NO ANALOGUE — Java's `this(...)` constructor delegation and constructor
// OVERLOADS. A JavaScript class has exactly one constructor; the replacement is
// argument inspection inside it and static factories beside it, which is what
// this file covers. Java's private constructor has no JavaScript form either:
// the nearest thing is a private static brand checked in the constructor, and
// it is a runtime check rather than a visibility rule.
//
// NO ANALOGUE — generic constructors. There are no type parameters anywhere; a
// JSDoc @template on a class is the closest, and it is in jsdoc/callback-and-template.js.

'use strict';

const EventEmitter = require('events').EventEmitter;

// --- implicit constructor ----------------------------------------------------------
//
// No `constructor` member. One is synthesised, and whether it emits a js_method
// row is a ruling the fixture exists to be adjudicated against. `Implicit`
// still has a constructor at runtime and `new Implicit()` still calls something.

class Implicit {
  method() { return 1; }
}

// A subclass with no constructor gets a synthesised `constructor(...args) {
// super(...args); }` — so it has an implicit SUPER_CALL that appears nowhere in
// the source.
class ImplicitSubclass extends Implicit { }

// --- explicit ------------------------------------------------------------------------

class Explicit {
  constructor(a, b = 2, ...rest) {
    this.a = a;
    this.b = b;
    this.rest = rest;
  }
}

// --- super, in every position it can occupy ---------------------------------------------

class Sub extends EventEmitter {
  constructor(name) {
    // `this` is in a TDZ until super() runs — reading it before this line
    // throws. That is a temporal rule inside one function body, and there is no
    // syntactic marker for the boundary.
    super();
    this.name = name;
  }
  method() {
    return super.emit('x');        // super.method(): lookup starts at the parent
  }
  get parentName() {
    return super.constructor.name;
  }
}

// super() in a conditional. Both branches must reach it exactly once; the
// compiler does not check, and running neither throws.
class ConditionalSuper extends EventEmitter {
  constructor(flag) {
    if (flag) {
      super();
      this.mode = 'a';
    } else {
      super();
      this.mode = 'b';
    }
  }
}

// A derived constructor that RETURNS an object — the return value replaces
// `this`, which is the only way a constructor can produce something other than
// its own instance.
class ReturnsOther extends Implicit {
  constructor(delegate) {
    super();
    return delegate;      // `new ReturnsOther(x)` evaluates to x
  }
}

// --- the private-constructor replacement -------------------------------------------------
//
// There is no `private constructor`. A brand checked at runtime is the closest
// analogue, and it fails at call time rather than at compile time.

class Singleton {
  static #instance = null;
  static #brand = Symbol('brand');

  constructor(brand) {
    if (brand !== Singleton.#brand) {
      throw new TypeError('use Singleton.get()');
    }
    this.created = Date.now();
  }

  static get() {
    if (Singleton.#instance === null) {
      Singleton.#instance = new Singleton(Singleton.#brand);
    }
    return Singleton.#instance;
  }
}

// --- static factories: the overload replacement ---------------------------------------------
//
// Java would write three constructors. JavaScript writes one and three named
// factories, which is both clearer and a completely different call graph: three
// call targets instead of one with three signatures.

class Duration {
  constructor(ms) { this.ms = ms; }
  static fromSeconds(s) { return new Duration(s * 1000); }
  static fromMinutes(m) { return Duration.fromSeconds(m * 60); }
  static parse(text) {
    const match = /^(\d+)(ms|s|m)$/.exec(text);
    if (!match) { throw new RangeError(text); }
    const [, value, unit] = match;
    switch (unit) {
      case 'ms': return new Duration(Number(value));
      case 's': return Duration.fromSeconds(Number(value));
      default: return Duration.fromMinutes(Number(value));
    }
  }
}

// --- the constructor FUNCTION, for the same shapes ---------------------------------------------

function LegacyDuration(ms) {
  if (!(this instanceof LegacyDuration)) { return new LegacyDuration(ms); }
  this.ms = ms;
}
LegacyDuration.fromSeconds = function fromSeconds(s) { return new LegacyDuration(s * 1000); };

// A constructor function whose "super call" is a .call, and whose prototype link
// is set separately — two statements that together are one `extends`.
function LegacyBus(name) {
  EventEmitter.call(this);
  this.name = name;
}
LegacyBus.prototype = Object.create(EventEmitter.prototype);
LegacyBus.prototype.constructor = LegacyBus;

// --- new.target: how a constructor knows how it was called ---------------------------------------

function DualUse(value) {
  if (new.target === undefined) { return new DualUse(value); }
  if (new.target !== DualUse) { this.subclassed = true; }
  this.value = value;
}

class SubclassOfDualUse extends DualUse {
  constructor(value) { super(value); }
}

module.exports = {
  Implicit, ImplicitSubclass, Explicit, Sub, ConditionalSuper, ReturnsOther,
  Singleton, Duration, LegacyDuration, LegacyBus, DualUse, SubclassOfDualUse
};
