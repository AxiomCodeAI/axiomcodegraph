// fixture: verified/prototype-constructor-forms/constructor-forms.js
// nature: runtime-bearing
// VERIFIED REPRO — the assignment-bound constructor function.
//
// Verified against js-impl@1b99d0d (pushed) and re-verified against b9e2676.
// Source only: this file states no expected fact. What it states is which forms
// the parser DOES handle, so the ones it does not are visible beside them rather
// than asserted about.
//
// FORMS A, K, L, M, N — constructor written as `function X(...) {}` — produce a
// js_type, a CLASS_METHOD/GETTER row for each prototype member, a
// CONSTRUCTOR_THIS_ASSIGNMENT field, and a js_type_heritage row. All four
// heritage forms are reached from here: UTIL_INHERITS, EXTENDS_CLAUSE,
// OBJECT_CREATE_PROTOTYPE, PROTOTYPE_ASSIGNMENT.
//
// FORMS B, C, D, E, G, H, I — the SAME constructor written as a function
// expression bound to a name — produce none of it. No js_type, so no owner for
// the prototype members, so no method rows, no fields and no heritage edge. The
// members appear only as anonymous <function-expression> rows.
//
// That contrast is the whole file. A and B differ in one token and the parser
// sees a type in one and nothing in the other.
//
// WHY IT MATTERS MORE THAN THE COUNT. Corpus-wide the lost form is 164 of 1,629
// prototype-member assignments, which sounds marginal. a 2010-era logging library is 1 covered
// against 56 lost — 98% of its prototype model — because
// `var Logger = exports.Logger = function (options) {...}` is how 2010-2015
// libraries spell a constructor, and that decade is the entire reason
// js_type_heritage exists as a relation.
//
// module system: CommonJS, governed by verified/package.json.

var util = require('util');
function Base(x) { this.x = x; }

// A: function declaration (the form that works)
function A(x) { this.x = x; }
A.prototype.m = function () { return 1; };
util.inherits(A, Base);

// B: var + anonymous function expression
var B = function (x) { this.x = x; };
B.prototype.m = function () { return 1; };
util.inherits(B, Base);

// C: var + NAMED function expression
var C = function C(x) { this.x = x; };
C.prototype.m = function () { return 1; };
util.inherits(C, Base);

// D: const + arrow (not a constructor, but prototype assigned anyway)
const D = function (x) { this.x = x; };
D.prototype.m = function () { return 1; };
D.prototype = Object.create(Base.prototype);

// E: chained assignment
var E = exports.E = function (x) { this.x = x; };
E.prototype.m = function () { return 1; };
util.inherits(E, Base);

// F: module.exports = function
module.exports = function F(x) { this.x = x; };

// G: Object.assign on a var-declared ctor
var G = function (x) { this.x = x; };
Object.assign(G.prototype, { m: function () { return 1; }, n: function () { return 2; } });

// H: Object.defineProperty accessor on a var-declared ctor
var H = function (x) { this.x = x; };
Object.defineProperty(H.prototype, 'p', { get: function () { return this.x; }, set: function (v) { this.x = v; } });

// I: prototype assignment to new Parent()
var I = function (x) { this.x = x; };
I.prototype = new Base(1);

// J: class (the ES6 control)
class J extends Base { m() { return 1; } }

// K: function declaration + Object.assign
function K(x) { this.x = x; }
Object.assign(K.prototype, { m: function () { return 1; } });

// L: function declaration + Object.defineProperty
function L(x) { this.x = x; }
Object.defineProperty(L.prototype, 'p', { get: function () { return this.x; } });

// M: function declaration + Object.create heritage
function M(x) { this.x = x; }
M.prototype = Object.create(Base.prototype);

// N: function declaration + prototype = new Base()
function N(x) { this.x = x; }
N.prototype = new Base(1);
