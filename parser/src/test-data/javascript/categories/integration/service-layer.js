// fixture: cjs/integration/service-layer.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (private members); ES2018 otherwise
//
// The modern half, and the composition root. Everything the categories cover,
// used together the way a real CommonJS service is written: destructured
// requires, a conditional require inside a function, a class implementing a
// @typedef contract with no `implements`, an Error hierarchy, closures returned
// from methods, an async generator, a getter, arity dispatch, and an export
// object built member by member.
//
// The call graph through this file is the thing worth checking end to end:
// every receiver is either a local class (LOCAL_CLASS), a require alias
// (IMPORT_ALIAS), a JSDoc-typed parameter (JSDOC) or a builtin
// (NODE_BUILTIN) — one call site of each receiverTypeSource, in one file.

'use strict';

const path = require('node:path');
const { NotFoundError, ServiceError } = require('./errors');
const MemoryUserRepository = require('./repository');

/**
 * @implements {import('./contracts.js').UserRepository}
 */
class CachingUserRepository {
  #cache = new Map();

  /**
   * @param {import('./contracts.js').UserRepository} inner
   */
  constructor(inner) {
    this.inner = inner;
  }

  /**
   * @param {string} id
   * @returns {Promise<?import('./contracts.js').User>}
   */
  async findById(id) {
    if (this.#cache.has(id)) { return this.#cache.get(id); }
    const found = await this.inner.findById(id);
    this.#cache.set(id, found);
    return found;
  }

  /** @param {import('./contracts.js').Page} page */
  list(page) { return this.inner.list(page); }

  /** @param {import('./contracts.js').User} user */
  async save(user) {
    this.#cache.delete(user.id);
    return this.inner.save(user);
  }

  get cached() { return this.#cache.size; }
}

class UserService {
  /**
   * @param {import('./contracts.js').UserRepository} repository
   * @param {import('./contracts.js').ErrorHandler} [onError]
   */
  constructor(repository, onError = () => {}) {
    this.repository = repository;
    this.onError = onError;
    this.auditLog = [];
  }

  /**
   * Arity dispatch: `get(id)` and `get(id, options)` are one method.
   *
   * @param {string} id
   * @param {{ throwIfMissing?: boolean }|function(Error): void} [options]
   * @returns {Promise<?import('./contracts.js').User>}
   */
  async get(id, options) {
    if (typeof options === 'function') { options = { throwIfMissing: false }; }
    const settings = Object.assign({ throwIfMissing: true }, options);
    try {
      const user = await this.repository.findById(id);
      if (user === null && settings.throwIfMissing) { throw new NotFoundError(id); }
      return user;
    } catch (err) {
      if (err instanceof ServiceError) { this.onError(err, 'get'); return null; }
      throw err;
    } finally {
      this.auditLog.push('get:' + id);
    }
  }

  /**
   * A closure returned from a method, capturing `this` lexically through an
   * arrow — the pattern that makes the returned function usable as a callback.
   *
   * @param {string} prefix
   * @returns {function(string): Promise<?import('./contracts.js').User>}
   */
  scoped(prefix) {
    return (id) => this.get(prefix + ':' + id, { throwIfMissing: false });
  }

  /** @returns {AsyncGenerator<import('./contracts.js').User>} */
  async *all(pageSize = 2) {
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.repository.list({ offset, limit: pageSize });
      if (page.length === 0) { return; }
      for (const user of page) { yield user; }
      if (page.length < pageSize) { return; }
    }
  }

  /**
   * A conditional require inside a method body — a module edge that is not at
   * the top of the file, and one that may never execute.
   *
   * @param {string} format
   * @returns {string}
   */
  render(format) {
    if (format === 'yaml') {
      const yaml = require('yaml');
      return yaml.stringify(this.auditLog);
    }
    return JSON.stringify(this.auditLog);
  }

  get auditPath() {
    return path.join(__dirname, 'audit.log');
  }
}

/**
 * The composition root, and the module's only export edge until the members
 * below it.
 *
 * @param {{ cache?: boolean }} [options]
 * @returns {UserService}
 */
function createService(options = {}) {
  const base = MemoryUserRepository.empty();
  const repository = options.cache ? new CachingUserRepository(base) : base;
  return new UserService(repository, (err, context) => {
    process.emitWarning(context + ': ' + err.message);
  });
}

module.exports = createService;
module.exports.UserService = UserService;
module.exports.CachingUserRepository = CachingUserRepository;
module.exports.createService = createService;
