const { Hono } = require('hono')

const users = new Hono()
users.get('/:id', (c) => c.json({ id: c.req.param('id') }))

module.exports = users
