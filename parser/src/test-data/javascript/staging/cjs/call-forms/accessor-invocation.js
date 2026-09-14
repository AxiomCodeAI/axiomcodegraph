// fixture: cjs/call-forms/accessor-invocation.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// A function invoked by READING a property. Every line marked below runs a
// method body and none of them is syntactically a call.
//
// GETTER_INVOCATION and SETTER_INVOCATION are RESERVED with a zero-row
// assertion, and this fixture is the argument for that: whether `obj.x` invokes
// anything depends on whether `x` is an accessor ON THAT OBJECT OR ITS
// PROTOTYPE CHAIN at that moment. It is a fact about the object at runtime, not
// about the expression. 1,225 getters are DECLARED in the schema's corpus and 0
// invocations are emittable from syntax.
//
// The declarations here are real and must be emitted: accessorPairKind on
// js_field (NONE | GETTER_ONLY | SETTER_ONLY | GETTER_SETTER) plus GETTER and
// SETTER methodKinds. It is only the invocation that cannot be read.

'use strict';

// --- declarations: every way to declare an accessor ------------------------------

class Temperature {
  constructor(celsius) { this._celsius = celsius; }

  get celsius() { return this._celsius; }
  set celsius(value) { this._celsius = Number(value); }

  get fahrenheit() { return this._celsius * 9 / 5 + 32; }   // GETTER_ONLY
  set kelvin(value) { this._celsius = value - 273.15; }     // SETTER_ONLY

  static get zero() { return new Temperature(0); }          // static getter

  get ['computed' + 'Name']() { return 'computed accessor'; }
}

// In an object literal.
const gauge = {
  _reading: 0,
  get reading() { return this._reading; },
  set reading(v) { this._reading = v; },
  get ['dyn' + 'amic']() { return 'dynamic'; }
};

// Via defineProperty — the third spelling, covered structurally in
// prototypes/define-property-accessors.js and repeated here so every invocation
// below has a declaration in the same file.
const lazy = {};
let lazyComputations = 0;
Object.defineProperty(lazy, 'value', {
  enumerable: true,
  configurable: true,
  get() { lazyComputations += 1; return lazyComputations; }
});

// --- invocations: none of these looks like a call -----------------------------------

const t = new Temperature(20);

const readGetter = t.celsius;              // invokes get celsius
const readDerived = t.fahrenheit;          // invokes get fahrenheit
t.celsius = 25;                            // invokes set celsius
t.kelvin = 300;                            // invokes set kelvin
const readStatic = Temperature.zero;       // invokes the static getter
const readComputed = t.computedName;

// Destructuring invokes the getter for each name it pulls out.
const { celsius, fahrenheit } = t;

// Spread invokes EVERY enumerable getter on the source. One token, N invocations,
// and the set of names is not in this file.
const snapshot = { ...gauge };

// Object.assign does the same, by reading.
const copied = Object.assign({}, gauge);

// JSON.stringify invokes every enumerable getter, transitively.
const serialised = JSON.stringify(gauge);

// A compound assignment invokes the getter AND the setter, in that order.
gauge.reading += 5;

// An increment likewise.
gauge.reading++;

// Optional chaining still invokes: `?.` guards nullishness of the receiver, not
// the accessor.
const optionalRead = gauge?.reading;

// A computed read invokes it too, and the name is not fixed by syntax — the two
// unresolvable things compound.
const key = 'reading';
const computedRead = gauge[key];

// Reading a property in a template substitution, a condition, an argument and a
// return position — the invocation is at each of these edgeRoles.
const inTemplate = `now ${gauge.reading}`;
const inCondition = gauge.reading ? 'set' : 'unset';
const inArgument = String(gauge.reading);
function inReturn() { return gauge.reading; }

// The proof that this is not decidable from syntax: `plain.value` and
// `lazy.value` are the same expression shape, and only one of them runs code.
const plain = { value: 1 };
const plainRead = plain.value;             // no invocation
const lazyRead = lazy.value;               // invocation, and it MUTATES

// Same object, same property name, different behaviour after a runtime edit.
// Any static answer about `plain.value` is wrong on one side of this line.
Object.defineProperty(plain, 'value', { get() { return 42; } });
const plainReadAfter = plain.value;        // now an invocation

// Reflect.get and the descriptor API: reading a getter WITHOUT invoking it.
const descriptor = Object.getOwnPropertyDescriptor(gauge, 'reading');
const getterFn = descriptor.get;           // the function itself, uninvoked
const invokedExplicitly = getterFn.call(gauge);
const viaReflect = Reflect.get(gauge, 'reading');   // invokes

module.exports = {
  Temperature, gauge, lazy, t,
  readGetter, readDerived, readStatic, readComputed, celsius, fahrenheit,
  snapshot, copied, serialised, optionalRead, computedRead,
  inTemplate, inCondition, inArgument, inReturn,
  plainRead, lazyRead, plainReadAfter, lazyComputations,
  descriptor, getterFn, invokedExplicitly, viaReflect
};
