// A computed-key write whose value is a read through the same key (#676): a
// property-wise copy, one name at a time, not every value under every name.
function alpha() { return 'a'; }
function beta() { return 'b'; }
const source = { alpha, beta };

function mixin(object, src, names) {
  names.forEach(function (name) {
    var func = src[name];
    object[name] = func;
  });
  return object;
}
const target = mixin({}, source, ['alpha', 'beta']);
function viaMixin() { return target.alpha(); }          // alpha only

function copyInline(dst, src) {
  for (const key of Object.keys(src)) { dst[key] = src[key]; }
  return dst;
}
const copied = copyInline({}, source);
function viaInline() { return copied.beta(); }          // beta only: the keys are enumerated from src (#707)

// The self-mixin that made every property hold every value.
const lodash = { alpha, beta };
mixin(lodash, lodash, ['alpha', 'beta']);
function viaSelf() { return lodash.alpha(); }           // alpha only

// The control: an UNCORRELATED computed write still writes every value the key holds.
function fill(obj, names, fn) { names.forEach(function (n) { obj[n] = fn; }); return obj; }
const filled = fill({}, ['alpha', 'beta'], beta);
function viaFill() { return filled.alpha(); }           // beta (the value written)
module.exports = { viaMixin, viaInline, viaSelf, viaFill };
