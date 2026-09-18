// Code no parser sees, and a scope where no name resolves statically.
const { helper } = require('./helpers');
function viaEval() { return eval('helper()'); }
function viaWith(o) { with (o) { return helper(); } }
module.exports = { viaEval, viaWith };
