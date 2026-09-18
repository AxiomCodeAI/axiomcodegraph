'use strict';
function helper() { return 1; }
function other() { return 2; }
function third() { return 3; }
function fourth() { return 4; }
globalThis.gHelper = helper;
global.gOther = other;
Object.assign(globalThis, { gThird: third });
globalThis.registry = { run: fourth };
module.exports = { helper, other, third, fourth };
