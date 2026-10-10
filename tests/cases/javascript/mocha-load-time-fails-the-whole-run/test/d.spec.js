const assert = require('assert')
const Thing = require('../lib/ctor')

describe('Thing', function () {
  it('builds one', function () {
    assert.strictEqual(new Thing(2).n, 2)
  })
})
