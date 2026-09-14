// fixture: cjs/commonjs/export-overwrite-conditional.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The same construct as export-overwrite-unconditional.js, guarded. The schema
// claims an overwrite only when it is UNCONDITIONAL, so every
// `module.exports = ...` in this file must be recorded with
// overwritesPreviousExport = false and isConditional = true: whether the earlier
// edges survive is decided at runtime, and the fact base must not assert either
// outcome.
//
// A parser that treats a guarded overwrite as an overwrite deletes exports that
// exist on the other branch. A parser that treats an unguarded one as
// conditional keeps exports that do not exist. The two fixtures exist as a pair
// because either error alone looks correct in isolation.
//
// Grounded in the browser/node dual-build idiom several HTTP and encoding
// libraries use, and in the `if (process.env.NODE_ENV === 'production')` swap a
// view library's index.js has shipped for years.

'use strict';

// --- edges written before any guard ----------------------------------------

exports.shared = function shared() { return 'shared'; };
module.exports.version = '1.0.0';

// 1. Guarded by an if with no else. On the false branch, `shared` and `version`
//    are the module's exports.
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./module-exports-assignment');
}

// 2. Guarded by if/else. BOTH branches overwrite, so at runtime the earlier
//    edges never survive — but that is a fact about the pair of branches, not
//    about either assignment, and no single row can carry it.
if (typeof window === 'undefined') {
  module.exports = { platform: 'node', shared: exports.shared };
} else {
  module.exports = { platform: 'browser' };
}

// 3. Inside a try. The overwrite may be skipped by a throw in the expression
//    on its right-hand side.
try {
  module.exports = require('fast-serialize');
} catch (err) {
  module.exports.fallback = true;
}

// 4. Inside a function body. Runs only if something calls it, which may be
//    never — and if it is called twice, it runs twice.
function installTestDouble(double) {
  module.exports = double;
}

// 5. Inside a loop body. Executes zero or more times.
for (const key of Object.keys(process.env.FIXTURE_KEYS || {})) {
  module.exports = { key };
}

// 6. Short-circuit and ternary forms. The assignment is an expression here, not
//    a statement, and it is still an overwrite when it runs.
process.env.FIXTURE_SWAP && (module.exports = { swapped: true });
const chosen = process.env.FIXTURE_ALT
  ? (module.exports = { alt: true })
  : module.exports;

module.exports.installTestDouble = installTestDouble;
module.exports.chosen = chosen;
