'use strict';
const util = require('../lib/util');
const { helper, Base } = require('../lib/util');
const Derived = require('../lib/util').Derived;
const path = require('path');

function local(a) { return a; }
const localArrow = (b) => b;

function run() {
  local(1);
  localArrow(2);
  helper(3);
  util.helper(4);
  util.arrow(5);
  util.extra();
  util.another();
  const b = new Base(1);
  b.greet();
  const d = new Derived(2);
  d.greet();
  d.shout();
  const l = new util.Legacy(3);
  l.value();
  util.Legacy.create(4);
  Base.make(5);
  util.obj.m();
  util.obj.f();
  util.obj.g(1);
  path.join('a', 'b');
  helper.call(null, 6);
  helper.apply(null, [7]);
  const bound = helper.bind(null);
  bound(8);
  (function iife() { local(9); })();
  [1, 2].forEach((x) => local(x));
  console.log('done');
  return b.size;
}
run();
module.exports = run;
