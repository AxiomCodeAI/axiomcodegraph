import { expect, it } from 'vitest'
import { run } from './pipeline'

it('widens through the pipeline', () => {
  expect(run({ width: 1 }).width).toBe(3)
})
