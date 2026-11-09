// census: bun_serve (stress-5 mutation m38b shape; violation hono-5-06)
// The same wrapper, synchronous: the served wrapper serves the inner route behind its use('*').
import { Hono } from 'hono'
import { wrapApp } from './wrap'

declare const Bun: { serve(o: { fetch: (r: Request) => Response | Promise<Response>; port: number }): void }

const inner = new Hono()
inner.get('/hello', (c) => c.text('hi'))
inner.post('/echo', async (c) => c.json(await c.req.json()))

const app = wrapApp(inner)
Bun.serve({ fetch: app.fetch, port: 3000 })
