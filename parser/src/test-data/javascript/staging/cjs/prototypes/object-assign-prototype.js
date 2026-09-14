// fixture: cjs/prototypes/object-assign-prototype.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (Object.assign, shorthand methods, spread in ES2018 form)
//
// declarationForm = OBJECT_ASSIGN_PROTOTYPE. N members declared by ONE CALL,
// and the member names are the keys of an object literal that is an ARGUMENT.
// Nothing about the call's shape says a type gained members; the fact lives in
// which function is being called and what its first argument is.
//
// The hard sub-case is at the bottom: when the source is not a literal, the
// member names are not in this file at all, and the honest answer is that the
// type gained an unknown set of members. A parser that emits nothing there is
// right; a parser that guesses is not.
//
// Grounded in a web framework's `mixin(app, EventEmitter.prototype)`, a runtime's
// internal streams, and the `Object.assign(Foo.prototype, {...})`
// idiom that replaced `util._extend`.

'use strict';

const EventEmitter = require('events').EventEmitter;

function Server(port) {
  this.port = port;
  this.routes = [];
}

// --- the canonical form: object literal as the source ------------------------

Object.assign(Server.prototype, {
  listen(cb) {
    this.listening = true;
    return cb && cb(this.port);
  },
  close() {
    this.listening = false;
  },
  // A field, not a method, in the same call.
  defaultPort: 3000,
  // An accessor pair declared inside the literal.
  get url() { return 'http://localhost:' + this.port; },
  set url(_v) { throw new Error('read only'); },
  // A computed key: this member's name is not fixed by syntax.
  ['route_' + 'get'](path) { return this.routes.push(path); }
});

// --- mixing in ANOTHER prototype --------------------------------------------
//
// The source is EventEmitter.prototype. Every enumerable own member of it is
// copied onto Server.prototype, and none of those names appears in this file.
// This is an inheritance-shaped operation written as a call, but it is a COPY,
// not a link: Server.prototype's [[Prototype]] is unchanged, so `instanceof
// EventEmitter` is still false. That distinction is invisible in the syntax and
// is the reason heritageForm has a separate value for each mechanism.

Object.assign(Server.prototype, EventEmitter.prototype);

// --- a mixin factory --------------------------------------------------------
//
// Real mixin code hides the assign behind a helper, so the callee is not
// `Object.assign` and matching on that name finds nothing.

function mixin(target, ...sources) {
  for (const source of sources) {
    Object.assign(target, source);
  }
  return target;
}

const Serializable = {
  toJSON() { return { port: this.port }; },
  fromJSON(raw) { this.port = raw.port; return this; }
};

const Comparable = {
  equals(other) { return other && other.port === this.port; }
};

mixin(Server.prototype, Serializable, Comparable);

// --- spread instead of assign ------------------------------------------------
//
// Same intent, different operator, and it produces a NEW object rather than
// mutating one — so this REPLACES Server.prototype the way an object-literal
// assignment does, discarding everything above.

function Client(host) { this.host = host; }
Client.prototype = { ...Serializable, ...Comparable, constructor: Client };

// --- the unnameable case ----------------------------------------------------
//
// The source is a value computed at runtime. The set of members Server gains is
// not derivable from this file, and no correct row can name them.

const plugins = require('../commonjs/exports-shorthand');
Object.assign(Server.prototype, plugins);

function applyPlugins(target, names) {
  return names.reduce((acc, name) => Object.assign(acc, require('./' + name)), target);
}
applyPlugins(Client.prototype, ['object-create-chain']);

// --- assign onto something that is NOT a prototype ---------------------------
//
// The control. Same callee, same argument shape, and it declares no members on
// any type — the target is a plain options object. A matcher keyed on
// "Object.assign with an object literal" mints phantom members here.

const options = Object.assign({}, { strict: true }, { depth: 2 });

module.exports = { Server, Client, mixin, options };
