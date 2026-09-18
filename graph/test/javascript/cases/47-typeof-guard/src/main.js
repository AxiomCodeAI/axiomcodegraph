// A typeof or Array.isArray guard types the subject's references inside the
// guarded region only (#701): the ternary's true branch, the right side of &&,
// the if body. Outside the region the subject keeps its own values.
class Query { toString() { return 'q'; } exec() { return 1; } }

function viaTernary(path) { return typeof path === 'string' ? path.split('.') : path; }
function viaAnd(items, base) {
  return items.filter(p => typeof p === 'string' && p.length > 0 && p.startsWith(base));
}
function viaIf(paths) {
  if (typeof paths === 'string') {
    paths = paths.split(' ');
  }
  return paths;
}
function viaNumber(n) { if (typeof n === 'number') { return n.toFixed(2); } return n; }
function viaIsArray(val) {
  if (Array.isArray(val)) { return val.map(v => v); }
  return Array.isArray(val) ? val.slice() : val;
}
// The control: a polymorphic parameter keeps its project value outside the guard,
// and inside a NEGATED guard nothing is typed.
function viaPolymorphic(q) {
  if (typeof q === 'string') { return q.trim(); }
  return q.exec();
}
function viaNegated(q) {
  if (typeof q !== 'string') { return q.exec(); }
  return q;
}
function run() { viaPolymorphic(new Query()); viaNegated(new Query()); }
module.exports = { run, viaTernary, viaAnd, viaIf, viaNumber, viaIsArray };
