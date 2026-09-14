// fixture: verified/jsdoc-on-assigned-function/param-on-assigned-function.js
// nature: runtime-bearing
// VERIFIED REPRO — @param on a function that is the RIGHT-HAND SIDE of an
// assignment or declaration produces no js_type_reference row at df58770; it did
// at ba8846c. A regression on the identical corpus: js_type_reference fell
// 35,954 -> 33,886 and @param recall misses rose 1,310 -> 4,212.
//
// Verified against js-impl@df58770 (pushed) against js-impl@ba8846c.
// Source only; no expected facts.
//
// CONTROL — a function DECLARATION. Its @param rows are emitted on both builds.
// LOST 1 — the assigned-named-function spelling, `app.x = function x(a, b) {}`.
// LOST 2 — the const-arrow spelling, `const f = (a, b) => {}`.
// LOST 3 — a plain `const f = function (a, b) {}`.
//
// The tags describe the FUNCTION's parameters, whichever side of an `=` the
// function sits on. Routing the JSDoc to the assignment as "the expression owner
// of last resort" is right for a @type over a statement and wrong for @param,
// which has nowhere to go on an assignment and must walk down to the callable.
// The four worst packages lose 894, 289, 242 and 232 rows this way; the first
// is an ODM library, the second an application server.
//
// module system: CommonJS, governed by verified/package.json.
'use strict';
const app = {};

/**
 * CONTROL — declaration.
 * @param {String} ext
 * @param {Function} fn
 * @returns {Object} app
 */
function declared(ext, fn) { return { ext, fn }; }

/**
 * LOST 1 — assigned named function expression.
 * @param {String} ext
 * @param {Function} fn
 * @returns {Object} app
 */
app.engine = function engine(ext, fn) { return { ext, fn }; };

/**
 * LOST 2 — const arrow.
 * @param {Object} dep
 * @param {Number} index
 * @returns {void}
 */
const processDependency = (dep, index) => { app[index] = dep; };

/**
 * LOST 3 — const anonymous function expression.
 * @param {String} name
 * @returns {String} name
 */
const plain = function (name) { return name; };

module.exports = { declared, app, processDependency, plain };
