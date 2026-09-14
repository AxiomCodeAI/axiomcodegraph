// fixture: cjs/commonjs/module-exports-members.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015 (const, arrow, computed property name)
//
// `module.exports.foo = ...` — the MODULE_EXPORTS_MEMBER form, 380 sites in the
// schema's corpus. Never reassigns module.exports itself, so every edge here
// survives to runtime and overwritesPreviousExport is false throughout. The
// overwrite cases live in their own two fixtures, deliberately, because the
// difference between them is the thing that has to be distinguishable.
//
// Grounded in a runtime's path module and a web framework's utils, which both build their
// export object one member at a time.

'use strict';

const crypto = require('crypto');

// A function, named on the left and anonymous on the right. The export's name
// comes from the assignment target, not from the value.
module.exports.digest = function (body) {
  return crypto.createHash('sha1').update(body).digest('base64');
};

// A function, named on both sides, and the names DISAGREE. exportedName is
// `weakDigest`; the function's own name is `weakDigestImpl`, and that is the name that
// appears in a stack trace.
module.exports.weakDigest = function weakDigestImpl(body) {
  return 'W/' + body.length;
};

// An arrow. No `this`, no `arguments`, no name of its own except by inference.
module.exports.isAbsolute = (p) => p.charCodeAt(0) === 47;

// A plain value, not a callable. exportedValueKind is not FUNCTION.
module.exports.defaultCharset = 'utf-8';

// An object literal.
module.exports.contentTypes = { html: 'text/html', json: 'application/json' };

// An identifier — the exported thing is declared elsewhere in the file.
function normalizeType(type) {
  return { value: type, quality: 1 };
}
module.exports.normalizeType = normalizeType;

// A class. Assignment-declared, so the type's evidence is an expression.
module.exports.Segment = class Segment {
  constructor(pattern) {
    this.pattern = pattern;
  }
  match(pathname) {
    return this.pattern === pathname;
  }
};

// A computed export name. Syntax does not fix the exported name, and a row that
// invents one is wrong. isComputedName on the expression says so.
const dynamicKey = 'compileDigest';
module.exports[dynamicKey] = function (val) { return val; };

// Nested: a property of an already-exported object. This is NOT a module edge —
// it mutates a value that happens to be reachable from module.exports.
module.exports.contentTypes.xml = 'application/xml';

// Object.defineProperty on module.exports. Still an export, with a different
// exportForm, and it can be non-enumerable — which an importer using
// Object.keys will not see even though `require('...').deprecated` works.
Object.defineProperty(module.exports, 'deprecated', {
  enumerable: false,
  get() { return true; }
});
