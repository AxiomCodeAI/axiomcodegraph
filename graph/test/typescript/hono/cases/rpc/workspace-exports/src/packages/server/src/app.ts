import { Hono } from 'hono'

const app = new Hono()
const routes = app.get('/sessions', (c) => c.json([]))

export type AppType = typeof routes
export default app
