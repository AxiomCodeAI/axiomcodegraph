const assert = require('assert')
const { fmt } = require('../lib/fmt')

describe('fmt', function () {
  it('wraps', function () {
    assert.strictEqual(fmt('x'), '<x>')
  })
  require('./parts/extra')
})
