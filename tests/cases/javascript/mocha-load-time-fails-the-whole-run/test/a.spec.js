const assert = require('assert')
const { build } = require('../lib/build')

describe('build', function () {
  const keys = build({ x: 1 })
  it('lists the keys', function () {
    assert.deepStrictEqual(keys, ['x'])
  })
})
