const path = require('path')
const { Fmt, extend } = require('..')

test('loads a plugin by its name', () => {
  extend(require(path.join(__dirname, '..', 'plugins', process.env.PLUGIN || 'upper')))
  expect(new Fmt('b').render()).toBe('[B]')
})
