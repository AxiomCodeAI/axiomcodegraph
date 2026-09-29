const assert = require('assert');
const { normalize } = require('../lib/text');

function runCase(input, want) {
  assert.strictEqual(normalize(input), want);
}

runCase('  Hello ', 'hello');
runCase('ABC', 'abc');
console.log('ok');
