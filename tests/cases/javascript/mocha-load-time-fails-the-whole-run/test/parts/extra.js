const assert = require('assert')
const { fmt } = require('../../lib/fmt')

it('wraps the empty string', function () {
  assert.strictEqual(fmt(''), '<>')
})
