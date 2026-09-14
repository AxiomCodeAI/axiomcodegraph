// fixture: cjs/prototypes/util-inherits.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5
//
// An `extends` edge expressed as a CALL. heritageForm = UTIL_INHERITS. There is
// no `extends` token anywhere in this file and every class in it has a
// superclass.
//
// This is the case that decides whether the engine can see inheritance in ANY
// pre-ES6 codebase. The schema measured util.inherits only twice in its corpus —
// and says explicitly not to size the work from that number, because the runtime's own library
// has been modernised since. A 2015-era corpus inverts it.
//
// Grounded in a runtime's duplex stream and its fs ReadStream/WriteStream
// and every library that predates `class`.

'use strict';

const util = require('util');
const inherits = require('util').inherits;
const EventEmitter = require('events').EventEmitter;
const { Readable } = require('stream');

// --- the canonical form ------------------------------------------------------

function ReadStream(path) {
  // The superclass constructor call, written as `.call(this, ...)`. This is the
  // `super()` of the prototype era: same effect, and the receiver is an
  // ARGUMENT rather than the syntactic receiver — receiverPosition = FIRST_ARGUMENT.
  Readable.call(this, { encoding: 'utf8' });
  this.path = path;
}

// The extends edge. Argument 0 is the subtype, argument 1 the supertype, and
// the ORDER is the only thing that says which is which.
util.inherits(ReadStream, Readable);

ReadStream.prototype._read = function _read() {
  this.push(null);
};

// --- through a destructured alias --------------------------------------------
//
// Same function, and the callee text is now `inherits`, not `util.inherits`. A
// matcher keyed on the member expression finds nothing here.

function WriteStream(path) {
  EventEmitter.call(this);
  this.path = path;
}
inherits(WriteStream, EventEmitter);

// --- inheriting from something that is itself assignment-declared -------------
//
// A two-level chain where neither level uses `class`.

function BufferedWriteStream(path, size) {
  WriteStream.call(this, path);
  this.size = size;
}
inherits(BufferedWriteStream, WriteStream);

BufferedWriteStream.prototype.flush = function flush() {
  // A super-method call in the prototype era: reach the supertype's prototype
  // explicitly and pass the receiver as an argument.
  return WriteStream.prototype.emit.call(this, 'flush', this.size);
};

// --- the hand-rolled equivalent ----------------------------------------------
//
// heritageForm = OBJECT_CREATE_PROTOTYPE. util.inherits is a two-line helper and
// plenty of code inlines it, which means the same edge appears in a form that
// shares no callee with the one above. Both lines together are one edge; the
// `constructor` repair on the second line is bookkeeping, not heritage.

function Socket(fd) {
  EventEmitter.call(this);
  this.fd = fd;
}
Socket.prototype = Object.create(EventEmitter.prototype);
Socket.prototype.constructor = Socket;

// --- Object.setPrototypeOf: a third spelling ---------------------------------
//
// Mutates the link in place rather than replacing the prototype object, so
// members already on Duplex.prototype survive — which the Object.create form
// above discards. Same edge, different side effects.

function Duplex(fd) {
  Socket.call(this, fd);
}
Duplex.prototype.write = function write(chunk) { return chunk.length; };
Object.setPrototypeOf(Duplex.prototype, Socket.prototype);
Object.setPrototypeOf(Duplex, Socket);   // static inheritance, a SECOND edge

// --- the superclass is not a name --------------------------------------------
//
// The supertype is the result of a call. isComputedSuperclass = true, and
// superTypeName cannot be filled from syntax — superTypeExpressionText is what
// the row carries instead.

function mixinBase(Base) {
  function Mixed() { Base.apply(this, arguments); }
  inherits(Mixed, Base);
  return Mixed;
}
const Timed = mixinBase(EventEmitter);

function TimedSocket(fd) { Timed.call(this, fd); }
inherits(TimedSocket, Timed);

// --- inheriting from a require, inline ---------------------------------------
//
// The supertype expression contains a module edge. superTypeName as written is
// `require('events').EventEmitter`, which is not an identifier at all.

function Bus() { require('events').EventEmitter.call(this); }
inherits(Bus, require('events').EventEmitter);

// --- an ES6 class extending a constructor function ----------------------------
//
// The two eras interoperate: `class extends` accepts any constructor. This edge
// IS an EXTENDS_CLAUSE and its supertype is a prototype-era type, so a model
// that keeps the two populations apart cannot follow it.

class ModernStream extends ReadStream {
  constructor(path) {
    super(path);
    this.modern = true;
  }
}

// --- and the reverse: a constructor function inheriting from a class ----------

class Base {
  constructor() { this.base = true; }
}
function LegacyChild() { Base.call(this); }
inherits(LegacyChild, Base);

module.exports = {
  ReadStream, WriteStream, BufferedWriteStream, Socket, Duplex,
  Timed, TimedSocket, Bus, ModernStream, Base, LegacyChild
};
