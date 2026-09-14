// fixture: cjs/prototypes/define-property-accessors.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5, except one ES2015 shorthand-method descriptor
//
// declarationForm = OBJECT_DEFINE_PROPERTY, 76 sites measured. A member declared
// by a call whose SECOND argument is the member name and whose THIRD is a
// descriptor object — so the name and the implementation are in two different
// arguments, and the member's kind (data, getter, setter, both) is decided by
// which keys the descriptor object happens to have.
//
// This is also where the reserved GETTER_INVOCATION value earns its keep: after
// this file runs, `res.sent` READS like a property and RUNS a function.
// Whether any given property read invokes a getter is a fact about the object at
// runtime, not about the reading expression, which is why the schema declares
// the value and asserts zero rows.
//
// Grounded in a web framework's response and request objects (which define most
// of their API this way) and a runtime's internal error classes.

'use strict';

function Reply(socket) {
  this._channel = socket;
  this._headers = {};
}

// --- getter only -------------------------------------------------------------

Object.defineProperty(Reply.prototype, 'sent', {
  configurable: true,
  enumerable: true,
  get: function () {
    return Boolean(this._sent);
  }
});

// --- getter and setter pair --------------------------------------------------

Object.defineProperty(Reply.prototype, 'code', {
  configurable: true,
  enumerable: true,
  get: function () { return this._status || 200; },
  set: function (value) {
    if (typeof value !== 'number') { throw new TypeError('code'); }
    this._status = value;
  }
});

// --- setter only -------------------------------------------------------------

Object.defineProperty(Reply.prototype, 'body', {
  configurable: true,
  set: function (value) { this._body = String(value); }
});

// --- a DATA property, not an accessor ----------------------------------------
//
// Same call, same shape, and it declares a field rather than a method pair. The
// descriptor's keys are the only difference. `writable: false` is the closest
// JavaScript has to `readonly`, and it is a runtime property of the object.

Object.defineProperty(Reply.prototype, 'protocol', {
  value: 'http',
  writable: false,
  enumerable: true
});

// --- non-enumerable ----------------------------------------------------------
//
// The member exists and `Object.keys` does not list it. Anything that models a
// type's members by enumerating an instance misses it.

Object.defineProperty(Reply.prototype, '_internal', {
  value: Symbol('internal'),
  enumerable: false
});

// --- ES2015 shorthand descriptor ---------------------------------------------

Object.defineProperty(Reply.prototype, 'channel', {
  get() { return this._channel; },
  set(value) { this._channel = value; }
});

// --- defineProperties: N members, one call -----------------------------------

Object.defineProperties(Reply.prototype, {
  encoding: {
    get: function () { return this._charset || 'utf-8'; },
    set: function (v) { this._charset = v; }
  },
  length: {
    get: function () { return this._body ? this._body.length : 0; }
  }
});

// --- a computed member name --------------------------------------------------

const NAME = 'dynamic' + 'Header';
Object.defineProperty(Reply.prototype, NAME, {
  get: function () { return this._headers[NAME]; }
});

// --- defineProperty on module.exports, not on a prototype ---------------------
//
// Same call, and it is an EXPORT rather than a member declaration. Which one it
// is depends entirely on the first argument.

Object.defineProperty(module.exports, 'lazyRouter', {
  enumerable: true,
  get: function () { return require('../commonjs/reexport-require'); }
});

// --- reading a getter ---------------------------------------------------------
//
// Every line here is a property READ that executes a function body. None of
// them is syntactically a call.

const res = new Reply(null);
const sent = res.sent;
const code = res.code;
res.code = 404;
res.body = 'not found';
const len = res.length;
const { encoding } = res;
const computed = res[NAME];

// A getter read on the module's own exports, which triggers a require.
const lazily = module.exports.lazyRouter;

module.exports.Reply = Reply;
module.exports.observed = { sent, code, len, encoding, computed, lazily };
