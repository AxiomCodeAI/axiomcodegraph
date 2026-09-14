// fixture: cjs/type-registry/type-placement.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (static blocks); ES2015 otherwise
//
// Port of java/type-registry/test-type-placement.java. WHERE a type can be
// declared, which decides ownerScopeLinkHash and enclosingMethodLinkHash.
//
// NO ANALOGUE — inner (non-static) classes and static nested classes. Java's
// `Outer.Inner` is a type nested in a type's NAMESPACE; JavaScript has no type
// namespace, so `Outer.Inner` is a static PROPERTY that happens to hold a class.
// The class itself is declared at whatever scope the expression sits in. That
// difference is the reason js_type has no owning-type FK and js_field does.
//
// NO ANALOGUE — package-private placement. Visibility is per-module: a
// declaration is either on module.exports or it is not.
//
// The key-chaining case: `module.exports = class {}` gives a type whose only
// name is its FILE's, which is why js_type's PK chains off ownerModuleLinkHash
// rather than a name, and why two such files in one directory do not collide.

'use strict';

// --- module scope --------------------------------------------------------------

class Exported { }
class NotExported { }

module.exports.Exported = Exported;

// --- inside a function body ---------------------------------------------------------
//
// A local class closing over a parameter. Each call produces a DIFFERENT class
// object, so "the type" is not one entity at runtime — the declaration is one
// syntactic site and N runtime classes.

function makeCounter(step) {
  class Counter {
    constructor() { this.value = 0; }
    increment() { this.value += step; return this.value; }
  }
  return Counter;
}
const CounterA = makeCounter(1);
const CounterB = makeCounter(10);
const sameSite = CounterA === CounterB;      // false

// --- inside a block, a loop, a catch and a static block --------------------------------

function placements(items) {
  const made = [];
  {
    class InBlock { }
    made.push(InBlock);
  }
  for (const item of items) {
    class InLoop { constructor() { this.item = item; } }
    made.push(InLoop);
  }
  try {
    throw new Error('x');
  } catch (err) {
    class InCatch { constructor() { this.err = err; } }
    made.push(InCatch);
  }
  return made;
}

// --- inside an IIFE, which is the pre-module way of scoping a type ---------------------------

const Encapsulated = (function () {
  class Private { secret() { return 'private'; } }
  class Public { reveal() { return new Private().secret(); } }
  return Public;
})();

// --- as a member of another type -------------------------------------------------------------
//
// The Java "nested class" replacement. `Outer.Inner` is a static field whose
// value is a class; the class's owner scope is the module, not Outer.

class Outer {
  static Inner = class Inner {
    constructor() { this.inner = true; }
  };
  static {
    Outer.LateInner = class LateInner { };
  }
  makeInner() { return new Outer.Inner(); }
}
Outer.AssignedInner = class AssignedInner { };

// --- as a property of an object literal ------------------------------------------------------

const namespace = {
  Model: class Model { },
  nested: { Deep: class Deep { } }
};

// --- as an argument, a return value and an array element ---------------------------------------

function accepts(Klass) { return new Klass(); }
const passedInline = accepts(class Inline { constructor() { this.inline = true; } });
const returned = (() => class Returned { })();
const inArray = [class First { }, class Second { }];

// --- the anonymous default export --------------------------------------------------------------
//
// This type's only name is the file's. See the header.

const DefaultExport = class { method() { return 1; } };

// --- a type declared inside a conditional ---------------------------------------------------------
//
// Only one of these two declarations ever runs, and both are in the file.

let Platform;
if (process.platform === 'win32') {
  Platform = class WindowsPlatform { sep() { return '\\'; } };
} else {
  Platform = class PosixPlatform { sep() { return '/'; } };
}

// --- a type whose declaration is inside a nested arrow, three boundaries deep -----------------------

const deep = () => () => () => class VeryNested { };

module.exports.NotExported = undefined;   // deliberately NOT exporting the class
module.exports.makeCounter = makeCounter;
module.exports.sameSite = sameSite;
module.exports.placements = placements;
module.exports.Encapsulated = Encapsulated;
module.exports.Outer = Outer;
module.exports.namespace = namespace;
module.exports.accepts = accepts;
module.exports.passedInline = passedInline;
module.exports.returned = returned;
module.exports.inArray = inArray;
module.exports.DefaultExport = DefaultExport;
module.exports.Platform = Platform;
module.exports.deep = deep;
