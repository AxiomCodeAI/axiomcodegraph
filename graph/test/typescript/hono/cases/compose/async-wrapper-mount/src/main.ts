// census: bun_serve (stress-5 mutation m38 shape; violation hono-5-06)
// A sub-app passed to an async wrapper that mounts it under its own use('*') and returns the wrapper, which is
// served: the inner route is served by the wrapper, behind the wrapper's middleware.
import { Hono } from 'hono'
import { wrapApp } from './wrap'

declare const Bun: { serve(o: { fetch: (r: Request) => Response | Promise<Response>; port: number }): void }

const inner = new Hono()
inner.get('/hello', (c) => c.text('hi'))

const app = await wrapApp(inner)
Bun.serve({ fetch: app.fetch, port: 3000 })
