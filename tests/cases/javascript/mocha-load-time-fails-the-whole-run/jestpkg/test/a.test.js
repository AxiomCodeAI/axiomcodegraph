const { jbuild } = require('../lib/build')

describe('jbuild', () => {
  const keys = jbuild({ y: 1 })
  test('lists the keys', () => {
    expect(keys).toEqual(['y'])
  })
})
