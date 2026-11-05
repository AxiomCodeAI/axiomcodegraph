import { Hono } from 'hono'
import { upgradeWebSocket } from '@/utils/websocket'

export const chat = new Hono().get(
  '/ws',
  async (c, next) => {
    c.header('x-chat', '1')
    await next()
  },
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(String(event.data))
    },
  }))
)
