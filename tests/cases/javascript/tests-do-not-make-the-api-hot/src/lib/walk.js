'use strict';
var each = require('./each');
function onItem(x) { return x; }
function walk(list) {
  each(list, function step0(x) { return x + 0; });
  each(list, function step1(x) { return x + 1; });
  each(list, function step2(x) { return x + 2; });
  each(list, function step3(x) { return x + 3; });
  each(list, function step4(x) { return x + 4; });
  each(list, function step5(x) { return x + 5; });
  each(list, function step6(x) { return x + 6; });
  each(list, function step7(x) { return x + 7; });
  each(list, function step8(x) { return x + 8; });
  each(list, function step9(x) { return x + 9; });
  each(list, function step10(x) { return x + 10; });
  each(list, function step11(x) { return x + 11; });
  each(list, function step12(x) { return x + 12; });
  each(list, function step13(x) { return x + 13; });
  each(list, function step14(x) { return x + 14; });
  each(list, function step15(x) { return x + 15; });
  each(list, function step16(x) { return x + 16; });
  each(list, function step17(x) { return x + 17; });
  each(list, function step18(x) { return x + 18; });
  each(list, function step19(x) { return x + 19; });
  each(list, function step20(x) { return x + 20; });
  each(list, function step21(x) { return x + 21; });
  each(list, onItem);
}
module.exports = { walk, onItem };
