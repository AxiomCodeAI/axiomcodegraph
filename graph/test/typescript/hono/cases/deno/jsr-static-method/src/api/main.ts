// census: deno_serve (shape of a Deno holdout project: a deno.json import map to jsr:, below the repository root,
// and an app created by a static method; served with Deno.serve({ port }, fetch))
import { Routes } from './routes.ts'

const hono = Routes.initHono('/static')
hono.get('/logo.jpg', (c) => c.text('jpg'))

Deno.serve({ port: 8000 }, hono.fetch)
