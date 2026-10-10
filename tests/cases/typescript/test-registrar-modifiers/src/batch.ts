import { audit } from './pricing'

// control: `each` on an object that is not a test runner hands over a plain callback;
// the function it runs is not a test
const rows = {
  each(values: number[]) {
    return (label: string, fn: (v: number) => void) => values.forEach(fn)
  },
}

export function runAudit(): void {
  rows.each([1, 2])('audit', (v) => {
    audit(v)
  })
}
