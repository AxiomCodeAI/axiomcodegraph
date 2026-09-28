'use strict';
const path = require('path');
function alpha() { return 'a'; }
function runAll(handlers) { handlers.forEach(h => h()); }
function dispatch(table, k) { return table[k](); }
function invoke(cb) { return cb(); }
function runList(ctx) { for (const f of ctx.list) f(); }
function viaLocal(o) { const fn = o.pick; return fn(); }
function viaCall(cb) { return cb.call(null); }
function pure() { return 1 + 2; }
function joins() { return path.join('a', 'b'); }
function direct() { return alpha(); }
module.exports = { alpha, runAll, dispatch, invoke, runList, viaLocal, viaCall, pure, joins, direct };
