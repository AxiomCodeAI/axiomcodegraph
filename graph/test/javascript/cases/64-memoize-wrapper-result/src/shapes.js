// Wrapper shapes whose closure returns MORE than the parameter's call, or whose
// site does not name the parameter itself. Each call must keep what it returned
// before the per-site answer: the fallback, the override, the default.
const memoize = require("./memoize");
const AlphaPlugin = require("./alpha");
const BetaPlugin = require("./beta");

class Fallback { fallbackOnly() { return 0; } }
class Mock { mockOnly() { return 1; } }
class Defaulted { defaultOnly() { return 2; } }

// `fn() || fallback`: what the argument returns, or the fallback.
const fallback = new Fallback();
function withFallback(fn) {
  return () => fn() || fallback;
}
// An override that wins over the built value.
let override = null;
function setOverride(o) { override = o; }
function lazyOr(make) {
  let cached;
  return () => override || (cached = cached || make());
}
// A result variable that starts as a default object.
const defaults = { defaultsOnly() { return 3; } };
function memoDefault(fn) {
  let result = defaults;
  let done = false;
  return () => { if (!done) { done = true; result = fn() || result; } return result; };
}
// A default parameter, a spread argument, a closure called inside its own wrapper.
const makeDefault = () => new Defaulted();
function lazy(make = makeDefault) { return () => make(); }
function eager(fn) { const c = () => fn(); c().run(); return c; }

const getFb = withFallback(() => new AlphaPlugin());
setOverride(new Mock());
const getOr = lazyOr(() => new BetaPlugin());
const getD = memoDefault(() => new AlphaPlugin());
const getDefault = lazy();
const args = [() => new BetaPlugin()];
const getSpread = lazy(...args);
const warm = eager(() => new AlphaPlugin());
// A wrapped getter wrapped again: the inner site's argument decides.
const getNested = memoize(memoize(() => new BetaPlugin()));

function shapes() {
  getFb().run();
  getFb().fallbackOnly();
  getOr().run();
  getOr().mockOnly();
  getD().run();
  getD().defaultsOnly();
  getDefault().defaultOnly();
  getSpread().run();
  warm().run();
  getNested().run();
}

module.exports = { shapes };
