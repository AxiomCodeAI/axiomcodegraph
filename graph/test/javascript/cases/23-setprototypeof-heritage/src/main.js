'use strict';
const { Child, GrandChild } = require('./child');
function main() {
  const c = new Child();
  c.base(); c.describe(); c.own();
  new GrandChild().base(); new GrandChild().own();
  Child.make();
  const one = { base() { return 'one'; } };
  const two = {};
  Object.setPrototypeOf(two, one);
  two.base();
}
main();
