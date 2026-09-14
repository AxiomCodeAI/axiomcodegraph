'use strict';
const __axiom = require("../__axiom_runtime.js"); const __p = __axiom.enter("middleware/index.js:1:1");
const { HttpError } = require('../lib/errors');
function requestId(req, res, next) {
    return __axiom.run("middleware/index.js:3:1", () => {
        req.id = Math.random().toString(36).slice(2);
        res.setHeader('x-request-id', req.id);
        next();
    });
}
function timing() {
    return __axiom.run("middleware/index.js:4:1", () => {
        return function timingMiddleware(req, res, next) {
            return __axiom.run("middleware/index.js:5:10", () => {
                const start = process.hrtime.bigint();
                res.on('finish', () => {
                    return __axiom.run("middleware/index.js:7:22", () => {
                        req.elapsed = Number(process.hrtime.bigint() - start);
                    });
                });
                next();
            });
        };
    });
}
function parseId(req, res, next, value) {
    return __axiom.run("middleware/index.js:11:1", () => {
        const id = Number(value);
        if (!Number.isInteger(id))
            return next(new HttpError(400, 'bad id'));
        req.todoId = id;
        next();
    });
}
function errorHandler(err, req, res, next) {
    return __axiom.run("middleware/index.js:12:1", () => {
        const status = err.status || 500;
        res.status(status).json(typeof err.toJSON === 'function' ? err.toJSON() : { error: err.message, status });
    });
}
const wrap = (fn) => {
    return __axiom.run("middleware/index.js:16:14", () => {
        return (req, res, next) => {
            return __axiom.run("middleware/index.js:16:22", () => {
                return Promise.resolve(fn(req, res, next)).catch(next);
            });
        };
    });
};
module.exports = { requestId, timing, parseId, errorHandler, wrap };

__axiom.exit(__p);
