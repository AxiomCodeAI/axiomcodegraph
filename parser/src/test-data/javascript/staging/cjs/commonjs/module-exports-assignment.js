// fixture: cjs/commonjs/module-exports-assignment.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES5
//
// `module.exports = <function>`, plus properties hung off that function after
// the fact. This is a web framework's entry module almost exactly: the module's export
// is a factory function, and the constructors it exposes are attached to it as
// static properties afterwards.
//
// exportedValueKind = FUNCTION here, and the later `createService.Plugin = `
// assignments are NOT exports in their own right — they mutate the already
// exported value. Whether they mint js_export rows is the ruling this fixture
// is written to be adjudicated against; either answer must be consistent, and
// the file's shape must not force a guess.

'use strict';

const EventEmitter = require('events').EventEmitter;

/**
 * Create an application.
 *
 * @returns {Function} the application, callable as a request handler
 */
function createService() {
  function app(req, res, next) {
    app.dispatch(req, res, next);
  }

  Object.assign(app, EventEmitter.prototype);
  app.inbound = Object.create(null);
  app.outbound = Object.create(null);
  app.setup();
  return app;
}

// The single export edge for this module. exportedName is `default`.
module.exports = createService;

// Statics hung off the exported function AFTER the export assignment. An
// importer sees them, but they are property writes on a function value, not
// separate module.exports assignments.
module.exports.application = createService;
createService.Plugin = require('./reexport-require');
createService.encode = function encode(options) { return options; };
createService.assets = require('./exports-shorthand');

// A getter installed on the exported object. Reading `service.parser` runs a
// function — the GETTER_INVOCATION case, which is reserved precisely because
// this fact lives on the object and not in the reading expression.
Object.defineProperty(createService, 'parser', {
  configurable: true,
  enumerable: true,
  get: function () {
    return require('./module-exports-members');
  }
});

createService.prototype = Object.create(EventEmitter.prototype);
createService.prototype.setup = function setup() {
  this.settings = {};
};
createService.prototype.handle = function dispatch(req, res, next) {
  return next && next();
};
