'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("lib/errors.js:1:1");
class HttpError extends Error {
    constructor(status, message) {
        return __axiom.run("lib/errors.js:3:3", () => {
            super(message);
            this.status = status;
        });
    }
    toJSON() {
        return __axiom.run("lib/errors.js:4:3", () => {
            return { error: this.message, status: this.status };
        });
    }
}
class NotFound extends HttpError {
    constructor(what) {
        return __axiom.run("lib/errors.js:6:36", () => {
            super(404, what + ' not found');
        });
    }
}
class BadRequest extends HttpError {
    constructor(msg) {
        return __axiom.run("lib/errors.js:7:38", () => {
            super(400, msg);
        });
    }
}
module.exports = { HttpError, NotFound, BadRequest };

__axiom.exit(__p);
