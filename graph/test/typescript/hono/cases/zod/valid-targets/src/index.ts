// census: req_valid, zvalidator, validator_builtin (SPEC 3.9 targets)
// c.req.valid(target) for every target links to that target's validator on the same route; a target with
// no validator on the route is declared (valid_without_validator).
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const J = z.object({ j: z.string() })
const Q = z.object({ q: z.string() })
const P = z.object({ id: z.string() })
const F = z.object({ f: z.string() })
const H = z.object({ h: z.string() })
const K = z.object({ k: z.string() })

const app = new Hono()
app.post(
  '/all/:id',
  zValidator('json', J),
  zValidator('query', Q),
  zValidator('param', P),
  zValidator('form', F),
  zValidator('header', H),
  zValidator('cookie', K),
  (c) => {
    const all = [c.req.valid('json'), c.req.valid('query'), c.req.valid('param'), c.req.valid('form'), c.req.valid('header'), c.req.valid('cookie')]
    return c.json(all)
  }
)
app.get('/missing', zValidator('query', Q), (c) => {
  // @ts-expect-error -- no json validator on this route: the read is declared, not linked
  const body = c.req.valid('json')
  return c.json([c.req.valid('query'), body])
})

export default app
