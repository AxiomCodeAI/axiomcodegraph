'use strict';
// A `@type` tag that widens the value to a base it satisfies (#723). What runs is
// LazyMap's own `get`; the tag makes the compiler name `Map.get` in lib.es2015, so the
// oracle must call the site undecided rather than score the engine's answer LIB_WRONG.
class LazyMap extends Map {
  get(key) { return super.get(key)?.(); }
}
/** @type {Map<string, Function>} */
module.exports = new LazyMap([['a', () => 1]]);
