// fixture: cjs/commonjs/conditional-require.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2015
//
// The module edge that is not at the top of the file. 13.6% of require() calls
// in the schema's corpus are not top-level statements — 1,048 inside a function
// body and 179 inside a block — and an extractor that walks the file's statement
// list, which is what every TypeScript module-edge extractor does because every
// TypeScript module edge IS a top-level declaration, misses one require in seven.
//
// Two columns carry the distinction: isTopLevel (false for all but the first
// require here) and isConditional (a module edge that may never execute).
// ownerScopeLinkHash and ownerMethodLinkHash matter too: a nested require binds
// in a function scope, not the module's.
//
// Grounded in a runtime's CommonJS loader (lazy requires to break
// cycles), a web framework's response object (a file sender required inside sendFile), and
// the near-universal `try { require('optional-dep') } catch {}` probe.

'use strict';

// The control: top-level, unconditional. isTopLevel = true.
const path = require('path');

// 1. Inside a function body. Runs once per call, and the binding lives in the
//    function scope. This is the single largest nested-require population.
function sendFile(res, file) {
  const send = require('file-stream');
  return send(res, file).pipe(res);
}

// 2. Guarded by an `if`. The edge may never execute at all.
let colors = null;
if (process.stdout.isTTY) {
  colors = require('./exports-shorthand');
}

// 3. Inside a try/catch — the optional-dependency probe. The catch swallows a
//    MODULE_NOT_FOUND, so an unresolvable specifier here is INTENDED, and a
//    parser reporting it as a defect is reporting the program working.
let fastJson;
try {
  fastJson = require('fast-serialize');
} catch (err) {
  fastJson = JSON.stringify;
}

// 4. Lazy singleton — the cycle-breaking idiom. The require runs on first call,
//    not at load, specifically so a circular dependency is resolved late.
let _loader = null;
function getLoader() {
  if (_loader === null) {
    _loader = require('./circular-a');
  }
  return _loader;
}

// 5. Inside a nested block that is not a function. `var` here hoists to the
//    module's function scope; the require does not move with it.
{
  var blockScopedRequire = require('./exports-array');
}

// 6. Inside a loop. Same specifier every iteration, one module instance, N
//    call sites for the cache lookup.
const plugins = [];
for (const name of ['./exports-shorthand', './module-exports-members']) {
  plugins.push(require(name));
}

// 7. Inside an arrow, inside a callback, inside a method. Three function
//    boundaries deep — the worklist has to descend explicitly to reach it.
const registry = {
  install(app) {
    return ['a', 'b'].map((tag) => {
      const helper = require('./module-exports-assignment');
      return helper(tag, app);
    });
  }
};

// 8. Short-circuit require. Evaluated only if the left side is falsy, so the
//    edge is conditional without any statement saying so.
const optional = process.env.NO_DEBUG || require('debug');

// 9. Inside a ternary consequent. Both branches are edges.
const impl = process.platform === 'win32'
  ? require('./module-exports-members')
  : require('./exports-shorthand');

// 10. Inside a switch case, and inside a catch block.
function loadByKind(kind) {
  switch (kind) {
    case 'stream': {
      return require('stream');
    }
    case 'buffer':
      return require('buffer');
    default:
      try {
        return require('./' + kind);
      } catch (e) {
        return require('./exports-array');
      }
  }
}

// 11. Inside a class method and a static block-free static method.
class Loader {
  load(name) {
    const zlib = require('zlib');
    return zlib.gzipSync(name);
  }
  static defaults() {
    return require('./module-exports-members').contentTypes;
  }
}

// 12. Inside an IIFE at top level. Syntactically nested, semantically eager —
//     it runs at load time exactly as a top-level require would. isTopLevel is
//     false and isConditional is false, and those two columns are not the same
//     question.
const eagerButNested = (function () {
  return require('os');
})();

module.exports = {
  path, sendFile, colors, fastJson, getLoader, blockScopedRequire,
  plugins, registry, optional, impl, loadByKind, Loader, eagerButNested
};
