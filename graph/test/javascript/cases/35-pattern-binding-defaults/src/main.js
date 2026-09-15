'use strict';
function inc(x) { return x + 1; }
function twice(x) { return x * 2; }
function thrice(x) { return x * 3; }
function withDefault(cb = () => 0, { mapper = twice } = {}) { return mapper(cb()); }
function nested({ opts: { run = inc } = {} } = {}) { return run(1); }
function fromArray([first = twice, second = inc] = []) { return first(second(1)); }
function fromVariable(o) { const { handler = inc, plain } = o; return handler(plain); }
function onlyDefault({ hook = thrice } = {}) { return hook(2); }
function main() {
  withDefault(); withDefault(() => 5, { mapper: inc });
  nested(); nested({ opts: { run: twice } });
  fromArray(); fromArray([thrice]);
  fromVariable({ handler: twice, plain: 1 }); fromVariable({ plain: 2 });
  onlyDefault();
}
main();
