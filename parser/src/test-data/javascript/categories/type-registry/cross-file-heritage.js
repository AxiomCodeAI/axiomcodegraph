// fixture: cjs/type-registry/cross-file-heritage.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// A SUPERTYPE THAT LIVES IN ANOTHER PROJECT FILE.
//
// Found by auditing for columns nothing in the corpus discriminates:
// `js_type_heritage.resolvedFilePath` is **empty in all 40 heritage rows**, and
// `importLinkHash` populates in only 14 — every one of them a Node builtin
// (`EventEmitter`, `Readable`). Every other `extends` in the corpus was
// same-file. So the three columns §3.3 says make a heritage row complete —
// `superTypeName` as written, `resolvedFilePath`, `importLinkHash` — had never
// been exercised together against a file the project actually contains.
//
// That is coverage on paper: 40 heritage rows, and not one of them tested the
// hop an engine has to walk. This file supplies it, in both eras, because the
// hop is the same and the syntax is not.
//
// Supertypes come from `../local-variables/helper-values.js`, which already
// exports a class (`Connection`), a constructor function (`Pool`) and a JSDoc
// typedef (`Credentials`).

'use strict';

const util = require('util');
const { Connection, Pool } = require('../local-variables/helper-values');
const helpers = require('../local-variables/helper-values');
const { Segment } = require('../commonjs/module-exports-members');

// --- ES6 class extending a class imported by DESTRUCTURED require ------------------
//
// superTypeName = "Connection", and the import hop is the destructured binding.

class PooledConnection extends Connection {
  constructor(url, pool) {
    super(url);
    this.pool = pool;
  }
  release() { this.pool.release(this); return this; }
}

// --- extending through a NAMESPACE binding ------------------------------------------
//
// superTypeName as written is `helpers.Connection` — a member expression, not an
// identifier — so the name that must be resolved is not the name that was
// imported. Same target, different hop shape.

class NamespacedConnection extends helpers.Connection {
  constructor(url) { super(url); this.viaNamespace = true; }
}

// --- extending a class that was itself declared by ASSIGNMENT in the other file -------
//
// `Segment` is `module.exports.Segment = class Segment {…}`, so the supertype's own
// declaration form is an expression. Nothing at this call site says so, and the
// engine following the hop lands on a type whose evidence is an assignment.

class NamedLayer extends Segment {
  constructor(pattern, name) {
    super(pattern);
    this.name = name;
  }
}

// --- extending a CONSTRUCTOR FUNCTION imported from another file ----------------------
//
// heritageForm = EXTENDS_CLAUSE, and the supertype is prototype-era. The two
// models meet across a module boundary.

class ManagedPool extends Pool {
  constructor(size) { super(size); this.managed = true; }
}

// --- the prototype-era spelling of the same cross-file edge -----------------------------
//
// util.inherits with an imported supertype: heritageForm = UTIL_INHERITS, and
// the import hop is identical while the syntax shares nothing with the above.

function LegacyPooled(url, pool) {
  Connection.call(this, url);
  this.pool = pool;
}
util.inherits(LegacyPooled, Connection);

// --- Object.create against an imported prototype ------------------------------------------

function CreatedPooled(url) {
  Connection.call(this, url);
}
CreatedPooled.prototype = Object.create(Connection.prototype);
CreatedPooled.prototype.constructor = CreatedPooled;

// --- extending a require INLINE, with no binding at all -----------------------------------
//
// superTypeName as written is the whole call expression. There is no local name
// to resolve, so the import hop and the supertype name are the same node.

class InlineRequired extends require('../local-variables/helper-values').Connection {
  constructor(url) { super(url); this.inline = true; }
}

// --- a JSDoc @extends naming a type from another file ---------------------------------------
//
// The comment channel's version of the same hop: the supertype is named only in
// a comment, and it is an imported type. `js_type_reference.resolvedFilePath` is
// the column that would carry it, and it is empty everywhere too.

/**
 * @extends {import('../local-variables/helper-values.js').Connection}
 * @implements {import('../integration/contracts.js').UserRepository}
 */
class DocumentedSubclass extends Connection {
  /** @param {import('../local-variables/helper-values.js').Credentials} creds */
  constructor(creds) {
    super('doc://', creds);
  }
}

module.exports = {
  PooledConnection, NamespacedConnection, NamedLayer, ManagedPool,
  LegacyPooled, CreatedPooled, InlineRequired, DocumentedSubclass
};
