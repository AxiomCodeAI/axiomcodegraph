// `once`: a function expression returned, the result held in a variable.
function once(f) {
  let done = false;
  let value;
  return function () {
    if (!done) {
      done = true;
      value = f();
    }
    return value;
  };
}
// `lazy`: the closure returns the parameter's call directly.
function lazy(make) {
  return () => make();
}
// CONTROL: a closure that returns its parameter itself, not a call of it.
function constant(v) {
  return () => v;
}
// CONTROL: a closure that calls its parameter but returns something else.
function tap(g) {
  return () => { g(); return new Gamma(); };
}
class Gamma { render() { return 1; } }
module.exports = { once, lazy, constant, tap, Gamma };
