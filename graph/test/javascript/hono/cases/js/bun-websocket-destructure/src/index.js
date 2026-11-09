// census: none (oracle gap O10, JavaScript): a library function taken by destructuring a library call's result
import { Hono } from 'hono'
import { createBunWebSocket } from 'hono/bun'

const { upgradeWebSocket } = createBunWebSocket()

const app = new Hono()
app.get('/ws', upgradeWebSocket(() => ({ onMessage() {} })))

export default app
