function ping(x) { return x; }
function pong(x) { return x; }
const Keys = { a: () => ping(1), b() { return 2; } };
function main() { Keys.a(); }
const run = () => ping(2); function helper() { return pong(3); }
function callHelper() { helper(); }
function first() { return 4; } const mapped = [1].map(function (v) { return ping(v); });
function callFirst() { first(); }
const named = () => pong(5); const listed = [2].map(() => ping(6));
function callNamed() { named(); }
function outer() { return function (v) { return pong(v); }; }
function callOuter() { outer(); }
const wrap = () => () => pong(7);
function callWrap() { wrap(); }
