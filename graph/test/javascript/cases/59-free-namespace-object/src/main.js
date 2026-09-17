'use strict';
// A namespace object installed on the global by a dependency is never declared in the
// tree, so the members written onto it had no owner and the calls a line later resolved
// to nothing (#724). The free name is the object's identity within the module.
/* global target */
target.build = function () { return 'build'; };
target.test = function () { return 'test'; };
target.all = function () { return target.build() + target.test(); };

// The control: the identical shape on a declared object, which always resolved.
const declared = {};
declared.build = function () { return 'd'; };
declared.all = function () { return declared.build(); };

function run() { return target.all() + declared.all(); }
module.exports = { run };
