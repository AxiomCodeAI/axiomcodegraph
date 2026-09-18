'use strict';
const kRun = Symbol('run');
class Queue {
  [kRun]() { return 1; }
  [`tpl`]() { return 2; }
  ['lit']() { return 3; }
  [42]() { return 4; }
  get ['acc']() { return 5; }
  ['named'] = () => 6;
}
const o = { [kRun]() { return 7; }, [`olit`]() { return 8; } };
function main() {
  const q = new Queue();
  q.lit(); q.tpl(); q[42](); q.acc; q.named();
  o.olit();
}
main();
