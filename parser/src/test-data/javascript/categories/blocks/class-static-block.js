// fixture: categories/blocks/class-static-block.js
// nature: runtime-bearing
// JsBlockKind.CLASS_STATIC_BLOCK — declared, documented `static { ... }`, zero rows.
//
// The column-scoped enum audit found this and the whole-cell audit could not:
// the string CLASS_STATIC_BLOCK IS emitted corpus-wide, in js_scope.scopeKind,
// so exact-cell matching marks the value covered on another enum's evidence.
// js_block carries 17 kinds and 148,000 rows and none of them is this one.
//
// It is the TypeScript NAMESPACE_BODY / MODULE_BODY defect exactly: a body that
// produces a scope and no block row. The control is in the same file — the class
// body, the method bodies and the module body all produce blocks.
//
// module system: CommonJS, governed by categories/package.json.
'use strict';

class Registry {
  static entries = [];

  static {
    // Runs at class-definition time, in its own scope, with its own `this`.
    Registry.entries.push('bootstrap');
  }

  static {
    // Two of them, because one wrapper that survives a single occurrence and
    // collapses on the second is the failure this file also has to catch.
    Registry.entries.push('second');
  }

  add(name) {
    { // a plain nested block, the control
      Registry.entries.push(name);
    }
    return Registry.entries.length;
  }
}

module.exports = { Registry };
