// fixture: cjs/local-variables/cross-file-locals.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// Port of java/local-variables/CrossFileLocalVariables.java. Locals whose types
// live in ANOTHER FILE, which is where the schema's three-hop IR-completeness
// story is exercised end to end:
//
//   1. the declared type NAME as written,
//   2. the importing module (js_variable.initializerKind = REQUIRE_CALL plus
//      importLinkHash), and
//   3. js_import.resolvedFilePath.
//
// The parser resolves NOTHING across the file boundary. If those three columns
// are present the row is complete even though no link was followed, and that is
// the measure that replaces "resolution rate".
//
// 34.4% of the oracle's declines are calls through a required binding — this
// exact shape — which makes it the single most load-bearing pattern in the
// corpus.

'use strict';

// The require whose binding every local below is typed by. This one line is hop
// two and hop three of every call site in the file.
const helpers = require('./helper-values');
const { Connection, Pool, Defaults, createConnection } = require('./helper-values');
const { Segment } = require('../commonjs/module-exports-members');

// A local initialised by `new` on an imported class. The receiver's type is
// knowable from THIS file plus one import hop; receiverTypeSource = IMPORT_ALIAS.
function usesImportedClass(url) {
  const conn = new Connection(url);
  conn.connect();
  const open = conn.isOpen;
  return [conn, open];
}

// A local initialised by a call on the namespace binding. The receiver is
// `helpers`, a require alias, and the callee name is `createConnection`.
function usesNamespaceBinding(url) {
  const conn = helpers.createConnection(url);
  return conn.close();
}

// A local initialised by a destructured import. The alias is the imported
// FUNCTION, so the call has no receiver at all.
function usesDestructuredBinding(url) {
  const conn = createConnection(url);
  return conn.url;
}

// A local typed only by a JSDoc reference to a typedef in the other file. There
// is no runtime evidence of the type anywhere; the only hop is the comment.
/**
 * @param {import('./helper-values.js').Credentials} credentials
 * @returns {string}
 */
function usesImportedTypedef(credentials) {
  /** @type {import('./helper-values.js').Credentials} */
  const local = credentials;
  return local.user + ':' + local.token;
}

// A local bound to an imported CONSTRUCTOR FUNCTION rather than a class. Same
// three hops; the type at the other end has no `class` keyword.
function usesConstructorFunction(size) {
  const pool = new Pool(size);
  pool.release(null);
  return pool.acquire();
}

// A local bound to a frozen constant object from another file. Its members are
// values, not a type, and reading one is a property access across a module
// boundary with no type involved at all.
function usesImportedConstants() {
  const timeout = Defaults.timeoutMs;
  const retries = Defaults.retries;
  return timeout * retries;
}

// A local bound to a class that was itself exported by assignment
// (module.exports.Segment = class Segment {...}). The type's declaration form on the
// far side is an expression, and nothing about this call site says so.
function usesAssignmentDeclaredClass(pattern) {
  const layer = new Segment(pattern);
  return layer.match(pattern);
}

// The chain that has no hop at all: a local bound to a builtin. The target is in
// the lib_* population, not this project, and resolutionOutcome is
// AMBIENT_BUILTIN_TARGET — the class the schema measures at 24.4% of declines.
function usesBuiltin(text) {
  const buffer = Buffer.from(text, 'utf8');
  const map = new Map();
  map.set('b', buffer);
  return map.get('b').toString('base64');
}

// A local reassigned to a value of a different shape. isReassigned is true and
// the "type" of the binding is two different things at two points.
function reassigned(url) {
  let thing = new Connection(url);
  thing = createConnection(url);
  thing = null;
  return thing;
}

module.exports = {
  usesImportedClass, usesNamespaceBinding, usesDestructuredBinding,
  usesImportedTypedef, usesConstructorFunction, usesImportedConstants,
  usesAssignmentDeclaredClass, usesBuiltin, reassigned
};
