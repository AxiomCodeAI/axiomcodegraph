import { expectTypeOf } from 'vitest'
import { price } from '../src/price'

test('price types', () => {
  expectTypeOf(price(2)).toEqualTypeOf<number>()
})
