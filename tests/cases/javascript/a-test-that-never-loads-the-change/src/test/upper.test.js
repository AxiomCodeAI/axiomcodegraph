const { Fmt, extend } = require('../index.js')
const upper = require('../plugins/upper')

extend(upper)

test('renders upper case', () => {
  expect(new Fmt('a').render()).toBe('[A]')
})
