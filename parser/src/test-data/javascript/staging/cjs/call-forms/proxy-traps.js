// fixture: cjs/call-forms/proxy-traps.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// PROXY_TRAP_CALL, reserved with a zero-row assertion. A Proxy makes EVERY
// fundamental operation on an object a potential function call: property read,
// property write, `in`, `delete`, enumeration, invocation, construction. None of
// them looks like a call, and whether a given expression hits a trap depends on
// whether the value flowing into it is a Proxy — which is a runtime fact.
//
// The reason to have the fixture at all, given the value is reserved: it is the
// evidence for the reservation. A corpus with no Proxy in it makes
// PROXY_TRAP_CALL indistinguishable from an unimplemented enum value, and §4 of
// BUILDING-A-PARSER.md says that distinction has to be checkable.
//
// Grounded in the `require('module')._resolveFilename` interception used by
// test tooling, immutable-draft libraries, and a reactivity core.

'use strict';

const target = {
  name: 'target',
  greet(who) { return 'hello ' + who; }
};

const log = [];

const handler = {
  get(obj, prop, receiver) {
    log.push('get:' + String(prop));
    return Reflect.get(obj, prop, receiver);
  },
  set(obj, prop, value, receiver) {
    log.push('set:' + String(prop));
    return Reflect.set(obj, prop, value, receiver);
  },
  has(obj, prop) {
    log.push('has:' + String(prop));
    return Reflect.has(obj, prop);
  },
  deleteProperty(obj, prop) {
    log.push('delete:' + String(prop));
    return Reflect.deleteProperty(obj, prop);
  },
  ownKeys(obj) {
    log.push('ownKeys');
    return Reflect.ownKeys(obj);
  },
  getOwnPropertyDescriptor(obj, prop) {
    return Reflect.getOwnPropertyDescriptor(obj, prop);
  },
  defineProperty(obj, prop, desc) {
    log.push('defineProperty:' + String(prop));
    return Reflect.defineProperty(obj, prop, desc);
  },
  getPrototypeOf(obj) {
    log.push('getPrototypeOf');
    return Reflect.getPrototypeOf(obj);
  }
};

const proxied = new Proxy(target, handler);

// Every line below invokes a handler method. Not one is a CallExpression whose
// callee names the function that runs.
const read = proxied.name;                 // get trap
proxied.name = 'renamed';                  // set trap
const present = 'name' in proxied;         // has trap
delete proxied.missing;                    // deleteProperty trap
const keys = Object.keys(proxied);         // ownKeys + getOwnPropertyDescriptor
const spread = { ...proxied };             // ownKeys + get, once per key
const proto = Object.getPrototypeOf(proxied);

// A method call through a proxy is TWO operations: a get trap that returns the
// function, then an ordinary invocation of it. One source expression, two
// distinct things happening, and only the second is a call site.
const greeted = proxied.greet('world');

// --- apply and construct traps ------------------------------------------------------
//
// A proxy around a FUNCTION intercepts calling and `new`. The callee of the
// call site is `callable`; the function that runs is `apply`.

function bare(x) { return x * 2; }

const callable = new Proxy(bare, {
  apply(fn, thisArg, argList) {
    log.push('apply');
    return Reflect.apply(fn, thisArg, argList) + 1;
  },
  construct(fn, argList, newTarget) {
    log.push('construct');
    return Reflect.construct(fn, argList, newTarget);
  }
});

const applied = callable(21);              // apply trap: 43, not 42
const constructed = new callable(1);       // construct trap

// --- the trap that makes a MISSING property look present ------------------------------
//
// An autovivifying proxy. `anything.at.all.works` resolves, so no static claim
// about which properties exist can be correct.

const magic = new Proxy({}, {
  get(_obj, prop) {
    if (prop === Symbol.toPrimitive || typeof prop === 'symbol') { return undefined; }
    return magic;
  }
});
const chained = magic.a.b.c.d;

// --- a revocable proxy ------------------------------------------------------------------
//
// After revoke() every operation throws. The same expression is valid and then
// is not, with no source change between them.

const { proxy: revocable, revoke } = Proxy.revocable(target, handler);
const beforeRevoke = revocable.name;
revoke();

// --- the control ---------------------------------------------------------------------
//
// Identical expressions against the raw target. No traps, no calls.

const plainRead = target.name;
target.name = 'target';
const plainIn = 'name' in target;

module.exports = {
  target, proxied, handler, log,
  read, present, keys, spread, proto, greeted,
  callable, applied, constructed, chained, beforeRevoke,
  plainRead, plainIn
};
