// fixture: cjs/prototypes/prototype-assignment.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (arrow, computed key, template literal)
//
// Members declared by assignment. This is §3 of BUILDING-A-PARSER.md in its
// purest form: every line below emits trivially as an expression and the
// STRUCTURE — that a type gained a method — is absent unless something mints it.
//
// The schema's ruling is that these produce real js_method / js_field rows with
// declarationForm saying how they were written, AND the expression row, tied by
// sourceExpressionLinkHash. Emitting only the expression loses the member;
// emitting only the member loses the fact that the assignment executes at a
// particular point in the module's evaluation.
//
// Measured in the schema corpus: 361 prototype methods, 233 prototype fields,
// 521 statics, 15 whole-prototype replacements.
//
// Grounded in a web framework's application and response objects and a
// runtime's readable stream, all of which are built this way.

'use strict';

const EventEmitter = require('events').EventEmitter;

function Container(name) {
  EventEmitter.call(this, name);
  this.name = name;
  this.settings = {};
}

// --- PROTOTYPE_ASSIGNMENT: methods ------------------------------------------

// Named function expression on the right. Two names again: `set` on the
// prototype, `setSetting` inside.
Container.prototype.set = function setSetting(key, value) {
  this.settings[key] = value;
  return this;
};

// Anonymous function expression. The member's name exists only on the left.
Container.prototype.get = function (key) {
  return this.settings[key];
};

// An arrow. Its `this` is LEXICAL, so this "method" does NOT see the instance —
// it sees the module's `this`. Same declaration form, different and usually
// wrong semantics, and only thisBinding distinguishes them.
Container.prototype.brokenGetter = () => this;

// A method assigned from an existing function rather than a function literal.
// The declaration site and the function's own declaration site are different
// lines in different scopes.
function handleRequest(req, res) {
  return res.end(this.name);
}
Container.prototype.handle = handleRequest;

// The same function installed under two names. One function, two members, and
// they are not copies.
Container.prototype.dispatch = handleRequest;

// A generator and an async method by assignment.
Container.prototype.entries = function* () {
  for (const key of Object.keys(this.settings)) { yield [key, this.settings[key]]; }
};
Container.prototype.flush = async function () {
  return Object.keys(this.settings).length;
};

// A computed member name. Syntax does not fix which member is declared.
const HOOK = 'onRequest';
Container.prototype[HOOK] = function () { return this.name; };

// A well-known symbol as the member name. Never a string, and it decides how
// `for...of` behaves on every instance.
Container.prototype[Symbol.iterator] = function () {
  return this.entries();
};

// --- PROTOTYPE_ASSIGNMENT: fields -------------------------------------------
//
// A value, not a function. A prototype field is SHARED by every instance, which
// is why the mutable one below is the classic bug: pushing into it mutates the
// prototype, not the instance.

Container.prototype.defaultEnv = 'development';
Container.prototype.basePath = '/';
Container.prototype.cache = [];

// --- STATIC_ASSIGNMENT ------------------------------------------------------
//
// A member of the constructor itself, not of its prototype. 521 sites in the
// schema corpus — MORE COMMON than the prototype form, and structurally a
// different member: `Container.create` is not callable on an instance.

Container.create = function create(name) { return new Container(name); };
Container.VERSION = '1.0.0';
Container.defaults = { env: 'development' };

// A static assigned from a require. The member's value comes from another
// module entirely, so the type has a member whose declaration is elsewhere.
Container.Plugin = require('../commonjs/reexport-require');

// --- PROTOTYPE_OBJECT_LITERAL: replacing the whole prototype ----------------
//
// 15 sites measured. This DISCARDS every member assigned above it, including
// the implicit `constructor` property, which is why real code re-adds it by
// hand. One statement, N member declarations, and one deletion of everything
// that came before — none of which is visible in the assignment's shape.

function Emitter() {
  this.listeners = {};
}

Emitter.prototype = {
  constructor: Emitter,
  on: function on(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return this;
  },
  off: function off(event) {
    delete this.listeners[event];
    return this;
  },
  emit(event, ...args) {
    return (this.listeners[event] || []).map((fn) => fn.apply(this, args));
  },
  get count() {
    return Object.keys(this.listeners).length;
  },
  set count(_v) {
    throw new Error('read only');
  },
  [Symbol.toStringTag]: 'Emitter'
};

// A member added AFTER the wholesale replacement. It survives; everything
// before the replacement did not. Ordering is the only thing that says so.
Emitter.prototype.once = function once(event, fn) {
  return this.on(event, fn);
};

// --- reading the prototype rather than writing it ---------------------------
//
// The control. These are ordinary expressions and declare nothing.

const proto = Container.prototype;
const hasSet = 'set' in Container.prototype;
const ownNames = Object.getOwnPropertyNames(Emitter.prototype);
const protoOfInstance = Object.getPrototypeOf(new Emitter());

// A write through an ALIAS of the prototype. It declares a member on
// Container just as the direct form does, and the assignment target does not
// contain the word `prototype` at all.
proto.viaAlias = function viaAlias() { return true; };

module.exports = {
  Container, Emitter, proto, hasSet, ownNames, protoOfInstance
};
