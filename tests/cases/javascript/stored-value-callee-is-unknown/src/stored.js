'use strict';
const path = require('path');
function alpha() { return 'a'; }
let handler = null;
function setHandler(h) { handler = h; }
function fire() { return handler(); }
class Emitter {
  constructor(cb) { this.cb = cb; }
  emit() { return this.cb(); }
  own() { return 1; }
  callsOwn() { return this.own(); }
}
function optsTypeof(opts) { if (typeof opts.onReady === 'function') return opts.onReady(); return null; }
function optsAnd(opts) { return opts.onDone && opts.onDone(); }
function optsIf(opts) { if (opts.onEnd) { opts.onEnd(); } }
function optsOptional(opts) { return opts.onStart?.(); }
function condInvoke(a, b, c) { return (c ? a : b)(); }
function seqInvoke(cb) { return (0, cb)(); }
function newFn(s) { return new Function(s)(); }
const helper = function () { return alpha(); };
function viaHelper() { return helper(); }
function joins() { return path.join('a', 'b'); }
function literalTrim() { return 'abc'.trim(); }
function pure() { return 1 + 2; }
function optsPlain(opts) { return opts.onReady(); }
function respond(req, res) { return res.status(200).send(req.query.q); }
module.exports = { alpha, setHandler, fire, Emitter, optsTypeof, optsAnd, optsIf, optsOptional, condInvoke, seqInvoke, newFn,
  viaHelper, joins, literalTrim, pure, optsPlain, respond };
