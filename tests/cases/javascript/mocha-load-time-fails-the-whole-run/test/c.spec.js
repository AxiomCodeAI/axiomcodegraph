const assert = require('assert')
const { parse } = require('../lib/parse')

describe('parse', function () {
  it('trims', function () {
    assert.strictEqual(parse(' x '), 'x')
  })
})
