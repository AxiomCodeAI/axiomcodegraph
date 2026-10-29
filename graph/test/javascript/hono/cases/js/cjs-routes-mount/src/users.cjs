const { Hono } = require('hono')

const users = new Hono()
users.get('/', (c) => c.json([]))
users.post('/', (c) => c.json({}, 201))

module.exports = users
