'use strict';
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
  toJSON() { return { error: this.message, status: this.status }; }
}
class NotFound extends HttpError { constructor(what) { super(404, what + ' not found'); } }
class BadRequest extends HttpError { constructor(msg) { super(400, msg); } }
module.exports = { HttpError, NotFound, BadRequest };
