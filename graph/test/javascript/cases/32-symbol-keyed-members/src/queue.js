'use strict';
const { kClose, kWrite } = require('./symbols');
const kRun = Symbol('run');
const kDone = Symbol('done');
const kShared = Symbol.for('shared');
function helper() { return 1; }

class Queue {
  constructor() {
    this[kDone] = () => { this[kRun](); };
  }
  [kRun]() { return helper(); }
  [kClose]() { return 2; }
  [kShared]() { return 5; }
  add() {
    this[kRun]();
    this[kDone]();
    this[kClose]();
    this[Symbol.for('shared')]();
  }
}
Queue.prototype[kWrite] = function () { return 3; };
const handlers = { [kRun]: function run() { return 4; }, [kDone]() { return 6; } };

function main() {
  const q = new Queue();
  q.add();
  q[kWrite]();
  handlers[kRun]();
  handlers[kDone]();
}
// a key that is the platform function itself, and a symbol the engine cannot follow
function dynamic(anySymbol) { const q = new Queue(); q[Symbol]?.(); return q[anySymbol](); }
module.exports = { Queue, main, dynamic, helper };
