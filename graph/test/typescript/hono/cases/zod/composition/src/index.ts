// census: zvalidator (SPEC 3.9 composition)
// A route validating a DERIVED schema is reached from its BASE: extend, merge, pick, omit, partial,
// z.array(Base), and .openapi('Name') metadata (still the same schema).
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from '@hono/zod-openapi'

const Base = z.object({ id: z.string(), name: z.string(), age: z.number() })
const Extra = z.object({ tag: z.string() })
const Extended = Base.extend({ email: z.string() })
const Merged = Base.merge(Extra)
const Picked = Base.pick({ id: true })
const Omitted = Base.omit({ age: true })
const Partial = Base.partial()
const Many = z.array(Base)
const Named = Base.openapi('Person')

const app = new Hono()
app.post('/extended', zValidator('json', Extended), (c) => c.json(c.req.valid('json')))
app.post('/merged', zValidator('json', Merged), (c) => c.json(c.req.valid('json')))
app.post('/picked', zValidator('json', Picked), (c) => c.json(c.req.valid('json')))
app.post('/omitted', zValidator('json', Omitted), (c) => c.json(c.req.valid('json')))
app.patch('/partial', zValidator('json', Partial), (c) => c.json(c.req.valid('json')))
app.put('/many', zValidator('json', Many), (c) => c.json(c.req.valid('json')))
app.post('/named', zValidator('json', Named), (c) => c.json(c.req.valid('json')))

export default app
