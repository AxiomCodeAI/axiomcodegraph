'use strict';
const { HttpError } = require('../lib/errors');
function requestId(req, res, next) { req.id = Math.random().toString(36).slice(2); res.setHeader('x-request-id', req.id); next(); }
function timing() {
  return function timingMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => { req.elapsed = Number(process.hrtime.bigint() - start); });
    next();
  };
}
function parseId(req, res, next, value) { const id = Number(value); if (!Number.isInteger(id)) return next(new HttpError(400, 'bad id')); req.todoId = id; next(); }
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  res.status(status).json(typeof err.toJSON === 'function' ? err.toJSON() : { error: err.message, status });
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { requestId, timing, parseId, errorHandler, wrap };
