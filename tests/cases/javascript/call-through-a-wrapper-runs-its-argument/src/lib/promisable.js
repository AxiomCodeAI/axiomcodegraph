export default function promisable(fn, arity) {
  function run(...args) {
    if (typeof args[arity - 1] === 'function') {
      return fn.apply(this, args);
    }
    return new Promise((resolve) => {
      args[arity - 1] = (err, value) => resolve(value);
      fn.apply(this, args);
    });
  }
  return run;
}
