const { Fmt } = require('..')

test('renders a value', () => {
  expect(new Fmt('a').render()).toBe('[a]')
})
