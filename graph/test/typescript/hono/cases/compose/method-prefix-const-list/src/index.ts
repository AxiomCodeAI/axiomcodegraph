// census: mount_dynamic_prefix_call (violation hono-5-03)
// A loop over a const list of route groups mounts `g.build()` at `g.prefix(V)`, a method whose template only uses
// its argument, called with a const: the prefix is /v2/members, and the routes are exact (a discarded basePath in
// the factory changes nothing).
import { makeApp } from './routes'
import { MemberRoutes } from './members'

declare const Deno: { serve(o: { port: number }, h: (r: Request) => Response | Promise<Response>): void }

const V = 'v2'
const app = makeApp()
const groups = [new MemberRoutes()]
for (const g of groups) {
  app.route(g.prefix(V), g.build())
}
app.get('/logo.png', (c) => c.text('img'))
Deno.serve({ port: 3000 }, app.fetch)
