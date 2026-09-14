// fixture: cjs/prototypes/object-create-chain.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5
//
// Inheritance with no constructor function anywhere. Object.create builds a
// [[Prototype]] chain out of plain objects, and the "types" are object literals.
//
// The honest reading is that most of this file declares NO types: the schema
// says object literals are values, and treating each one as a type is how a
// JavaScript fact base acquires 50,000 meaningless ones. So the interesting
// question this fixture poses is where the line falls — `Object.create(X)` where
// X is a prototype of a real constructor IS a heritage edge; `Object.create(null)`
// is a dictionary; and a chain of bare literals is neither.
//
// Grounded in the OLOO/"objects linked to other objects" style, node's
// `Object.create(null)` dictionaries, and a web framework's `Object.create(proto)` for
// its request/response objects.

'use strict';

const EventEmitter = require('events').EventEmitter;

// --- Object.create(null): a dictionary with NO prototype ---------------------
//
// Not a type, not an instance, and it has no `hasOwnProperty`, no `toString`
// and no `__proto__`. Node uses this everywhere a user-controlled string is a
// key, precisely so `__proto__` is inert.

const headers = Object.create(null);
headers['content-type'] = 'application/json';
headers['x-powered-by'] = 'fixture';

// --- Object.create(proto): a real heritage edge -------------------------------
//
// The prototype of a constructor function is the argument. heritageForm =
// OBJECT_CREATE_PROTOTYPE, and the subtype here is an OBJECT, not a function —
// so `ownerTypeLinkHash` has nothing named to point at unless the binding's name
// is taken as the type's.

const req = Object.create(EventEmitter.prototype);
req.method = 'GET';

// --- the three-level literal chain -------------------------------------------
//
// base <- derived <- leaf, entirely in literals. `leaf.describe()` walks two
// links to find its implementation, and `leaf.kind` shadows `base.kind` — which
// is property shadowing, not overriding, and there is no declaration of either.

const base = {
  kind: 'base',
  describe() { return 'a ' + this.kind; },
  init(name) { this.name = name; return this; }
};

const derived = Object.create(base);
derived.kind = 'derived';
derived.extra = function extra() { return this.describe() + '!'; };

const leaf = Object.create(derived, {
  // The second argument is a PROPERTY DESCRIPTOR MAP — the same shape
  // Object.defineProperties takes. So this one call both links a prototype and
  // declares members, and the members are keys of an argument.
  kind: { value: 'leaf', enumerable: true, writable: true },
  label: {
    get() { return this.kind.toUpperCase(); }
  }
});

// --- a factory returning linked objects ---------------------------------------
//
// The OLOO idiom. Every call produces an object whose prototype is `base`, and
// there is no constructor function and no `new` in the program.

function make(kind) {
  const o = Object.create(base);
  o.kind = kind;
  return o;
}

const first = make('first');
const second = make('second');

// --- __proto__ in a literal: the fourth spelling of the same link -------------
//
// Legal, standardised in Annex B, and still common. The link is a KEY in an
// object literal.

const viaProtoKey = {
  __proto__: base,
  kind: 'literal'
};

// --- reading and mutating the chain -------------------------------------------

const protoOfLeaf = Object.getPrototypeOf(leaf);
const isBase = base.isPrototypeOf(leaf);
const own = Object.prototype.hasOwnProperty.call(leaf, 'describe');

// Re-linking at runtime. The chain is not a static property of the program.
Object.setPrototypeOf(viaProtoKey, derived);

module.exports = {
  headers, req, base, derived, leaf, make, first, second,
  viaProtoKey, protoOfLeaf, isBase, own
};
