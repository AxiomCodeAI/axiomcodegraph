// fixture: verified/import-binding-shadowed/shadowed-require.js
// nature: runtime-bearing
// VERIFIED REPRO — two bindings with the same local name, and the import<->variable
// links between them keyed by NAME instead of by binding.
//
// Verified against js-impl@df58770 (pushed) and js-impl@ba8846c. Source only.
//
// CONTROL — distinct local names. Both link both ways, on both builds.
//
// SHAPE 1 — the same specifier required twice under the same name, top level
// then inside a function. Two bindings in two scopes.
// SHAPE 2 — a top-level destructured binding and a function-scope plain binding
// with the same local name, from DIFFERENT specifiers. Two bindings, two
// scopes, two modules.
//
// At ba8846c the EARLIER import of a repeated name had no boundVariableLinkHash
// (last wins). At df58770 the LATER one has none (first wins), and the later
// variable's importLinkHash points at the EARLIER import — the inner binding
// linked to the outer import, in both directions.
//
// Either way the key is (module, localName). Two `helper`s in two scopes are two
// bindings and two keys. The meaning check that sees this asserts the linked
// import and variable share a LINE; a check by name passes both builds and is
// wrong on both. Corpus-wide at df58770: 47 forward nulls, 152 forward
// wrong-targets, 177 reverse wrong-targets, all in application code that
// re-requires inside functions.
//
// module system: CommonJS, governed by verified/package.json.
'use strict';

// CONTROL — distinct names.
const pathUtil = require('path');
const osUtil = require('os');

// SHAPE 1 — same specifier, same local name, two scopes.
const helper = require('./helper');
function lazyOne() {
  const helper = require('./helper');
  return helper;
}

// SHAPE 2 — same local name, DIFFERENT specifiers, two scopes.
const { config } = require('./config-loader');
function lazyTwo() {
  const config = require('./config');
  return config;
}

module.exports = { pathUtil, osUtil, helper, lazyOne, config, lazyTwo };
