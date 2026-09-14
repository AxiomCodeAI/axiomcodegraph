'use strict';
// a for..of head that is a PATTERN: each name walks its path from the element
function helper() { return 1; }
function other() { return 2; }
class Plugin { constructor(run) { this.run = run; } }
const table = { a: helper, b: other };
const pairs = [['a', helper], ['b', other]];
const objs = [{ fn: helper }, { fn: other }];
const nested = [{ meta: { hooks: [helper] } }, { meta: { hooks: [other] } }];
const plugins = new Set([new Plugin(helper), new Plugin(other)]);
const byName = new Map([['a', helper], ['b', other]]);

function f1() { for (const [, fn] of pairs) fn(); }
function f2() { for (const { fn } of objs) fn(); }
function f3() { for (const [, fn] of Object.entries(table)) fn(); }
function f4() { for (const pair of Object.entries(table)) pair[1](); }
function f5() { for (const [name, fn] of pairs) { String(name); fn(); } }
function f6() { for (const { meta: { hooks: [first] } } of nested) first(); }
function f7() { for (const { run } of plugins) run(); }
function f8() { for (const [key, fn] of byName) { String(key); fn(); } }
function f9() { for (const [first, ...rest] of [[helper, other]]) { first(); rest[0](); } }
function f10() { for (const { fn: renamed } of objs) renamed(); }
function f11() { for (let [, fn] of pairs) fn(); }
function f12() { for (const plain of objs) plain.fn(); }
module.exports = { f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12 };
