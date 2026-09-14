'use strict';
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var proto = module.exports = function router(options) {
  function handle(req) { return proto.dispatch(req); }
  handle.options = options;
  return handle;
};
proto.dispatch = function dispatch(req) { return req; };
proto.use = function use(fn) { this.dispatch(fn); return this; };
function Layer(path) { this.path = path; }
Layer.prototype.match = function (p) { return p === this.path; };
util.inherits(Layer, EventEmitter);
exports = module.exports;
module.exports.Layer = Layer;
