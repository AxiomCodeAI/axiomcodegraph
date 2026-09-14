// fixture: cjs/commonjs/require-forms.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (const/let, destructuring, template literal)
//
// Every shape a resolvable `require` takes in the wild. Derived from the head of
// a web framework's entry and application modules and a runtime's HTTP server,
// which between them use all of: bare builtin, bare package, relative, relative
// with an explicit extension, directory-index, deep subpath, member-picked, and
// require used directly as an expression rather than bound to a name.
//
// Note what is NOT here: a non-literal specifier (require-non-literal.js), a
// require that is not top-level (conditional-require.js), and a require whose
// result is destructured (destructured-require.js). Each is its own fixture
// because each produces a different js_import row shape.

'use strict';

// --- bare specifiers -------------------------------------------------------

// Node builtin. resolutionOutcome is the RESOLVED_BUILTIN case, and it is also
// the population that carries 24.4% of the oracle's declines when no ambient
// declarations are loaded.
const path = require('path');
const EventEmitter = require('events').EventEmitter;
const { format } = require('util');

// Bare package specifier that this checkout does not install. Unresolvable for
// an environmental reason, which is not the same thing as a parser gap.
const mime = require('media-types');

// A bare package that IS installed in this checkout, transitively, with the
// require's RESULT called directly — `require(x)(…)`, the shape a namespaced
// logger factory made ubiquitous. resolutionOutcome = RESOLVED_EXTERNAL. The
// package name is an English word, excluded from the corpus-identity scrub on
// that basis; it was never a measured corpus.
const debug = require('debug')('fixture:require-forms');

// --- relative specifiers ---------------------------------------------------

const Plugin = require('./reexport-require');
const withExtension = require('./exports-shorthand.js');
const upOneLevel = require('../methods/method-kinds');

// --- require as an expression, not a binding -------------------------------

// Side-effect-only: the module edge exists, nothing is bound.
require('./module-exports-members');

// Called immediately. The require is the receiver of the call, so the module
// edge is nested inside a call expression rather than inside a variable
// initializer. A web framework's entry module does exactly this with a descriptor-merge helper.
const createService = require('./module-exports-assignment');
const appProto = require('./module-exports-assignment').prototype;

// Member-picked at the require site. The local name and the imported name
// differ, and neither is the specifier.
const inherits = require('util').inherits;

// Property access on a require, two hops deep.
const sep = require('path').posix.sep;

// require inside an argument list. No binding at all, and the module edge is
// an argument of another call.
Object.assign(module.exports, require('./module-exports-members'));

// --- require.resolve and the require object itself -------------------------
//
// require.resolve is a path computation, not a module edge that loads code.
// Whether these mint js_import rows is the oracle's ruling; the fixture exists
// so the ruling has something to be made against.

const resolvedPath = require.resolve('./require-non-literal');
const cacheKeys = Object.keys(require.cache);
const mainIsMe = require.main === module;

// --- the CommonJS free variables -------------------------------------------
//
// __dirname, __filename, module, exports and require are bindings no source
// line declares. They are the CommonJS module wrapper's parameters. In an ESM
// file every one of them is a ReferenceError, which is what makes them evidence
// of the module system rather than incidental.

const here = path.join(__dirname, 'fixtures');
const me = __filename;

function describe() {
  return format('%s <- %s (%s) [%s] %d cached', here, me, resolvedPath, sep, cacheKeys.length);
}

module.exports = {
  path: path,
  EventEmitter: EventEmitter,
  mime: mime,
  debug: debug,
  Plugin: Plugin,
  withExtension: withExtension,
  upOneLevel: upOneLevel,
  createService: createService,
  appProto: appProto,
  inherits: inherits,
  mainIsMe: mainIsMe,
  describe: describe
};
