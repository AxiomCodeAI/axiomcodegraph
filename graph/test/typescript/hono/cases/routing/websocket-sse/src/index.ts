// census: verb_literal_path (oracle gap O10; SPEC R5 library-call handlers)
// upgradeWebSocket(...) as the route handler is a library-call handler keyed at the call; a project handler
// returning streamSSE(...) is an ordinary project handler.
import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/cloudflare-workers'
import { streamSSE } from 'hono/streaming'

const app = new Hono()
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(String(event.data))
    },
  }))
)
app.get('/sse', (c) =>
  streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: 'tick' })
  })
)

export default app
