import { expect, it } from 'vitest'
import { booleanAttrs } from './config'

it('knows a boolean attribute', () => {
  expect(booleanAttrs.checked).toBe(true)
})
