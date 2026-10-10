import { expect, it } from 'vitest'
import { runAudit } from './batch'

it('runs the audit', () => {
  expect(runAudit()).toBeUndefined()
})
