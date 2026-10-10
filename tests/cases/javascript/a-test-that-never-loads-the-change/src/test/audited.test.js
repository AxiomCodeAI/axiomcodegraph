const { later } = require('fmtlib')
const { audit } = require('../lib/audit')

test('audits what it is handed', (cb) => {
  later(2, function check(v) { expect(audit(v)).toBe('audited 2'); cb() })
})
