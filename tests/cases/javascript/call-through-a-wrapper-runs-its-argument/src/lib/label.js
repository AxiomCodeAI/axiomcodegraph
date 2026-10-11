export default function label(fn) {
  return function labelled() { return fn.name; };
}
