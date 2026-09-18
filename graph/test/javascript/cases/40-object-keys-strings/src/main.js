// The elements of Object.keys(o) and the key of a for..in loop are strings (#685):
// a string method on one is an ambient terminal, not receiver_untyped.
function alpha() { return 'a'; }
function beta() { return 'b'; }
const handlers = { alpha, beta };

function viaForOf(fields) {
  const out = [];
  for (const key of Object.keys(fields)) {
    if (key.startsWith('a')) { out.push(key.split('.')); }
  }
  return out;
}
function viaCallbacks(fields) {
  const names = Object.getOwnPropertyNames(fields).filter(function (n) { return n.indexOf('_') !== 0; });
  const first = names[0].trim();
  Object.keys(fields).forEach(function (k) { first.concat(k.toUpperCase()); });
  return Object.keys(fields).reduce(function (acc, k) { return acc + k.length; }, 0);
}
function viaSpread(fields) {
  const all = [...Object.keys(fields), 'extra'];
  return all.map(function (k) { return k.padEnd(4); });
}
function viaForIn(fields) {
  const seen = [];
  for (const name in fields) { seen.push(name.toLowerCase()); }
  return seen;
}
// Controls: a for..of still binds the ELEMENT; a for..in over an array binds the
// index string, not the element, so the element is reached through the index.
function viaElement() {
  const fns = [alpha, beta];
  for (const fn of fns) { fn(); }
  for (const i in fns) { i.padStart(2); fns[i](); }
  for (const name in handlers) { handlers[name](); }
}
module.exports = { viaForOf, viaCallbacks, viaSpread, viaForIn, viaElement };
