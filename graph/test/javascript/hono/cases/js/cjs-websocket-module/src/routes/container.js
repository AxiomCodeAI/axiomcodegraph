const { Hono } = require('hono')
const { upgradeWebSocket } = require('../utils/websocket')

const app = new Hono()

app.get('/:id', (c) => c.json({ id: c.req.param('id') }))

app.get('/:id/logs/stream', upgradeWebSocket(async (c) => ({
  onOpen(_evt, ws) {
    ws.send(c.req.param('id'))
  },
})))

module.exports = app
