const { fmt } = require('../lib/fmt')

const t = Date.now()
for (let i = 0; i < 1e5; i++) fmt('b')
console.log(Date.now() - t)
