// fixture: cjs/integration/repository.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2018 (async iteration)
//
// The prototype-era half of the integration set: a UserRepository implemented
// as a constructor function with prototype-assigned methods, inheriting from
// EventEmitter through util.inherits, satisfying a @typedef contract it does not
// declare, and exported by `module.exports = `.
//
// Everything the schema calls a declaration-by-assignment is here in one file
// with real call sites through it: PROTOTYPE_ASSIGNMENT, STATIC_ASSIGNMENT,
// OBJECT_DEFINE_PROPERTY, UTIL_INHERITS.

'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const { NotFoundError, ConflictError } = require('./errors');

/**
 * An in-memory user store.
 *
 * @constructor
 * @augments {EventEmitter}
 * @implements {import('./contracts.js').UserRepository}
 * @param {Map<string, import('./contracts.js').User>} [seed]
 */
function MemoryUserRepository(seed) {
  EventEmitter.call(this);
  /** @type {Map<string, import('./contracts.js').User>} */
  this.store = seed || new Map();
  this.reads = 0;
}

util.inherits(MemoryUserRepository, EventEmitter);

/**
 * @param {string} id
 * @returns {Promise<?import('./contracts.js').User>}
 */
MemoryUserRepository.prototype.findById = async function findById(id) {
  this.reads += 1;
  const found = this.store.get(id) || null;
  this.emit('read', id, found !== null);
  return found;
};

/**
 * @param {import('./contracts.js').Page} page
 * @returns {Promise<Array<import('./contracts.js').User>>}
 */
MemoryUserRepository.prototype.list = async function list({ offset = 0, limit = 10 } = {}) {
  return Array.from(this.store.values()).slice(offset, offset + limit);
};

/**
 * @param {import('./contracts.js').User} user
 * @returns {Promise<import('./contracts.js').User>}
 */
MemoryUserRepository.prototype.save = async function save(user) {
  if (this.store.has(user.id)) {
    throw new ConflictError('id', new Error('duplicate ' + user.id));
  }
  this.store.set(user.id, user);
  this.emit('write', user.id);
  return user;
};

MemoryUserRepository.prototype.mustFind = async function mustFind(id) {
  const found = await this.findById(id);
  if (found === null) { throw new NotFoundError(id); }
  return found;
};

// An async generator by assignment.
MemoryUserRepository.prototype.stream = async function* stream() {
  for (const user of this.store.values()) { yield user; }
};

// A prototype FIELD, shared by every instance.
MemoryUserRepository.prototype.defaultLimit = 10;

// A getter installed by defineProperty. Reading `repo.size` runs a function.
Object.defineProperty(MemoryUserRepository.prototype, 'size', {
  enumerable: true,
  get: function () { return this.store.size; }
});

// Statics.
MemoryUserRepository.empty = function empty() { return new MemoryUserRepository(); };
MemoryUserRepository.VERSION = '1.0.0';

// Mixed-in behaviour, arriving by call rather than by inheritance.
Object.assign(MemoryUserRepository.prototype, {
  toJSON() { return { size: this.size, reads: this.reads }; },
  clear() { this.store.clear(); return this; }
});

module.exports = MemoryUserRepository;
module.exports.MemoryUserRepository = MemoryUserRepository;
