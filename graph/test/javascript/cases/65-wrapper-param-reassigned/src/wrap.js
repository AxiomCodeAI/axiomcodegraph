// Wrappers that WRITE their parameter before the returned closure calls it.
class A { aOnly() { return 1; } }
class Replaced { replacedOnly() { return 2; } }
class Dflt { dfltOnly() { return 3; } }

// Unconditional replacement: the site's argument never reaches the closure.
function swapped(fn) {
  fn = () => new Replaced();
  return () => fn();
}
// Conditional replacement: the site's argument, or the replacement.
function lazyGuard(fn) {
  if (typeof fn !== "function") fn = () => new Replaced();
  return () => fn();
}
// A default through `||`: the site's argument, or the default.
function lazyOrDefault(fn) {
  fn = fn || (() => new Dflt());
  return () => fn();
}
// A default through `??=`.
function lazyNullish(fn) {
  fn ??= () => new Dflt();
  return () => fn();
}
// CONTROL: no write at all — the site's argument alone.
function plain(fn) {
  return () => fn();
}
// CONTROL: another parameter is written, not the one the closure calls.
function otherWritten(fn, alt) {
  alt = () => new Replaced();
  return () => fn();
}
module.exports = { A, Replaced, Dflt, swapped, lazyGuard, lazyOrDefault, lazyNullish, plain, otherWritten };
