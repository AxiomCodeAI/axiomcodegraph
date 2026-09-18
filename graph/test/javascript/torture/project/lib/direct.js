'use strict';
// #640: a function registered as a callback in one place and called DIRECTLY in another. The
// direct call must be scored on its own edge; the registration elsewhere excuses nothing.
function helper() { return 1; }
function registers() { return new Promise((resolve) => setTimeout(() => { helper(); resolve(); }, 0)); }
const viaBind = Function.prototype.call.bind(helper);
function direct() { return viaBind(null); }
const stored = [];
function keep() { stored.push(helper); }
function callStored() { return stored[0](); }
module.exports = { helper, registers, direct, keep, callStored };
