// census: zvalidator, req_valid (SPEC 3.9 import forms: zod, zod/v4, zod/v3, zod/v4-mini, @hono/zod-openapi's z)
// The same validator shape with `z` taken from every specifier the corpus uses.
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { z as z4 } from 'zod/v4'
import { z as z3 } from 'zod/v3'
import * as zm from 'zod/v4-mini'
import { z as zo } from '@hono/zod-openapi'

const FromZod = z.object({ a: z.string() })
const FromV4 = z4.object({ b: z4.string() })
const FromV3 = z3.object({ c: z3.string() })
const FromMini = zm.object({ d: zm.string() })
const FromOpenapi = zo.object({ e: zo.string() })

const app = new Hono()
app.post('/zod', zValidator('json', FromZod), (c) => c.json(c.req.valid('json')))
app.post('/v4', zValidator('json', FromV4), (c) => c.json(c.req.valid('json')))
app.post('/v3', zValidator('json', FromV3), (c) => c.json(c.req.valid('json')))
app.post('/mini', zValidator('json', FromMini), (c) => c.json(c.req.valid('json')))
app.post('/fn', validator('json', (v) => zm.parse(FromMini, v)), (c) => c.json(c.req.valid('json')))
app.post('/openapi-z', zValidator('json', FromOpenapi), (c) => c.json(c.req.valid('json')))

export default app
