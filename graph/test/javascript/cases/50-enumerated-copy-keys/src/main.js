'use strict';
// A correlated copy whose keys are ENUMERATED from the source (#707): `for..in`,
// `for..of Object.keys`, an Object.keys(...).forEach callback, a project keys()
// helper, and an alias of Object.keys. Every property of the source is copied,
// one name to its own value, with no key name in the key binding.
function log() { return 1; }
const src = { alpha() { return log(); }, beta() { return log(); } };

const d1 = {}; for (const k in src) d1[k] = src[k];
const d2 = {}; for (const k of Object.keys(src)) d2[k] = src[k];
const d3 = {}; Object.keys(src).forEach(function (k) { d3[k] = src[k]; });
function t1() { return d1.alpha(); }
function t2() { return d2.alpha(); }
function t3() { return d3.beta(); }

// The extend helper of a home-grown class system: a keys() helper written over
// for..in, and the copy through a parameter pair.
function keys(o) { const a = []; for (const k in o) a.push(k); return a; }
function extend(obj1, obj2) { keys(obj2).forEach(function (k) { obj1[k] = obj2[k]; }); return obj1; }
const d4 = extend({}, src);
function t4() { return d4.alpha(); }

// `var keys = Object.keys` as an alias, and getOwnPropertyNames.
const ownKeys = Object.keys;
function assign(target, options) { for (const name of ownKeys(options)) target[name] = options[name]; return target; }
const d5 = assign({}, src);
function t5() { return d5.beta(); }
const d6 = {}; Object.getOwnPropertyNames(src).forEach(function (k) { d6[k] = src[k]; });
function t6() { return d6.alpha(); }
const names = Object.keys(src);
const d9 = {}; for (const k of names) d9[k] = src[k];
function t9() { return d9.beta(); }

// The controls: a key enumerated from ANOTHER object copies nothing from src, and
// a non-copy write under an enumerated key stays a string-typed key.
const other = { gamma() { return log(); } };
const d7 = {}; for (const k in other) d7[k] = src[k];
function t7() { return d7.alpha(); }
const d8 = {}; for (const k in src) d8[k.toUpperCase()] = log;
function t8() { return d8.ALPHA(); }
module.exports = { t1, t2, t3, t4, t5, t6, t7, t8, t9 };
