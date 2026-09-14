'use strict';
// A class extending a platform builtin (#619). The container's values flow through
// super.<m> and this.<m>, and every call on the platform base is an ambient terminal.
function doA() { return 'A'; }
function doB() { return 'B'; }

// The lazy plugin registry: entries handed to the platform constructor, read back
// through super.get in the overridden accessor.
class LazyMap extends Map {
  get(key) { const load = super.get(key); return load && load(); }
}
const reg = new LazyMap([['a', doA], ['b', doB]]);
function viaSubclass() { return reg.get('a'); }

// The control: the same entries through a plain Map.
const plain = new Map([['a', doA], ['b', doB]]);
function viaPlain() { return plain.get('a')(); }

// A constructor of its own: the collection is seeded from the super(...) argument.
class Registry extends Map {
  constructor(entries) { super(entries); this.ready = true; }
  run(key) { const fn = super.get(key); return fn(); }
  each() { super.forEach((fn) => fn()); }
}
const reg2 = new Registry([['a', doA]]);
function viaCtor() { return reg2.run('a'); }
function viaEach() { return reg2.each(); }
// Held outside the class: a member the class does not override reads the platform.
function viaOuterForEach() { reg2.forEach((fn) => fn()); }
function viaIteration() { for (const [, fn] of reg2) { fn(); } }

// A Set subclass, read through super.values().
class Bag extends Set {
  first() { for (const fn of super.values()) { return fn(); } }
}
const bag = new Bag([doB]);
function viaSet() { return bag.first(); }

// this.set / this.get inside the subclass: the platform's members through `this`.
class Store extends Map {
  add(key, fn) { this.set(key, fn); }
  call(key) { return this.get(key)(); }
}
const store = new Store();
store.add('a', doA);
function viaThis() { return store.call('a'); }

// A non-collection platform base: super(...) and the constructor are the platform's.
class AppError extends Error {
  constructor(message) { super(message); this.name = 'AppError'; }
  describe() { return super.toString(); }
}
function viaError() { return new AppError('x').describe(); }

module.exports = { viaSubclass, viaPlain, viaCtor, viaEach, viaOuterForEach, viaIteration, viaSet, viaThis, viaError };
