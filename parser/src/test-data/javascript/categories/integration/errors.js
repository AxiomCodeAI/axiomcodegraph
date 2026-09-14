// fixture: cjs/integration/errors.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2022 (Error `cause`); ES2015 otherwise
//
// The error hierarchy the service throws. Three levels of `extends`, a builtin
// at the root, and one legacy error declared as a constructor function — so the
// same hierarchy carries both an EXTENDS_CLAUSE edge and an
// OBJECT_CREATE_PROTOTYPE one.

'use strict';

class ServiceError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: Error, status?: number }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status || 500;
    Error.captureStackTrace(this, new.target);
  }

  /** @returns {{ name: string, message: string, status: number }} */
  toJSON() {
    return { name: this.name, message: this.message, status: this.status };
  }
}

class NotFoundError extends ServiceError {
  constructor(id) {
    super('user not found: ' + id, { status: 404 });
    this.id = id;
  }
}

class ConflictError extends ServiceError {
  constructor(field, cause) {
    super('conflict on ' + field, { status: 409, cause });
    this.field = field;
  }
}

// The prototype-era error, in the same hierarchy. `Error.call(this, ...)` does
// NOT set the message — that is the reason the modern form exists — so the
// message is assigned by hand.
function LegacyError(message) {
  Error.call(this, message);
  this.name = 'LegacyError';
  this.message = message;
  this.status = 500;
}
LegacyError.prototype = Object.create(Error.prototype);
LegacyError.prototype.constructor = LegacyError;
LegacyError.prototype.toJSON = ServiceError.prototype.toJSON;   // a borrowed method

module.exports = { ServiceError, NotFoundError, ConflictError, LegacyError };
