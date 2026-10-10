const { later } = require('../')

test('hands the value on', (cb) => {
  later(1, function seen(v) { expect(v).toBe(1); cb() })
})
