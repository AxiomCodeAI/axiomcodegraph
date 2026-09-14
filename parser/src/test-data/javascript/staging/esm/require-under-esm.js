// fixture: esm/require-under-esm.js
// module system: CommonJS SYNTAX under a declared ESM config
//   governing: staging/esm/package.json, "type": "module"
// nature: runtime-bearing — and this program CANNOT RUN. In an ES module
//   `require`, `module`, `exports`, `__dirname` and `__filename` are simply not
//   defined; every line below throws ReferenceError at first evaluation.
// syntax floor: ES2015
//
// contradictionKind = REQUIRE_UNDER_ESM — the direction the schema's corpus
// measured ZERO times, because it is a hard runtime crash rather than a
// bundler-tolerated one. Zero occurrences is why the fixture has to exist: the
// enum value is declared, no corpus exercises it, and an unemitted declared
// value is indistinguishable from a real gap without a fixture that forces it.
//
// The last section shows the CORRECT spelling of the same intent, which real
// ESM code uses constantly, and which is a different edge: createRequire.

const path = require('path');
const { readFileSync } = require('fs');

function loadConfig(name) {
  return require('./config/' + name);
}

module.exports = { path, readFileSync, loadConfig };
exports.alsoBroken = true;

const here = __dirname;
const me = __filename;
