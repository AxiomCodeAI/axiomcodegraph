'use strict';
// the dependency is DECLARED and NOT INSTALLED: no node_modules here. Its IR is staged
// with --library and reached through the package's own entry facts.
const alpha = require('alpha');
const { subHelper } = require('alpha/sub');
const gone = require('alpha/missing');
const nope = require('never-staged');
class Mine extends alpha.Base { hook() { return 42; } }
function main() {
  alpha.createClient().run();
  new Mine().run();
  subHelper();
  gone.anything();
  nope.thing();
}
main();
