// census: deno_serve, bun_serve
// Deno.serve(app.fetch) and Bun.serve({ fetch }) (runtime globals declared locally so the fixture typechecks).
import { Hono } from 'hono'

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void }
declare const Bun: { serve(opts: { fetch: (req: Request) => Response | Promise<Response> }): void }

export const app = new Hono()
app.get('/deno', (c) => c.text('deno'))

export function start(kind: 'deno' | 'bun') {
  if (kind === 'deno') Deno.serve(app.fetch)
  else Bun.serve({ fetch: app.fetch })
}
