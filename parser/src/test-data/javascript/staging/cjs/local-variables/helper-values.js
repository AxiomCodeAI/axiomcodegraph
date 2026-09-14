// fixture: cjs/local-variables/helper-values.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Port of java/local-variables/HelperTypes.java. A support module whose exports
// are the things cross-file-locals.js binds locals to — a class, a constructor
// function, a frozen constant object, a factory and a JSDoc-only type. The
// mixture is the point: a local's declared type in JavaScript can come from a
// class (a real js_type), from a JSDoc @typedef in another file (a
// COMMENT_ONLY js_type), or from nothing at all.

'use strict';

/**
 * @typedef {Object} Credentials
 * @property {string} user
 * @property {string} token
 */

class Connection {
  /**
   * @param {string} url
   * @param {Credentials} [credentials]
   */
  constructor(url, credentials) {
    this.url = url;
    this.credentials = credentials || null;
    this.open = false;
  }
  connect() { this.open = true; return this; }
  close() { this.open = false; return this; }
  get isOpen() { return this.open; }
}

// A constructor function beside the class, so an importer can bind a local to
// either kind of type.
function Pool(size) {
  this.size = size;
  this.free = [];
}
Pool.prototype.acquire = function acquire() { return this.free.pop() || null; };
Pool.prototype.release = function release(conn) { this.free.push(conn); };

const Defaults = Object.freeze({
  timeoutMs: 30000,
  retries: 3
});

/**
 * @param {string} url
 * @returns {Connection}
 */
function createConnection(url) {
  return new Connection(url).connect();
}

module.exports = { Connection, Pool, Defaults, createConnection };
