'use strict';
function first() { return 1; }
function second() { return 2; }
function k1() { return [first].concat([second])[1](); }
function k2() { return [first].concat(second)[1](); }
function k3() { return [[first], [second]].flat()[1](); }
function k5() { return Array.of(first).concat([second]).at(-1)(); }
function k4() { const ys = [...[first], second]; return ys[1](); }
function k6() { const xs = [first]; const ys = xs.concat([second]); return xs[0](); }
k1(); k2(); k3(); k5(); k4(); k6();
