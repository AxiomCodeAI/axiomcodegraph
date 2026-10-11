import { price } from '../src/price'

test('a runtime test whose name says types', () => {
  expect(typeof price(1)).toBe('number')
})
