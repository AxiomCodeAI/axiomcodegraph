// census: zvalidator, req_valid (SPEC 3.9 declaration forms)
// The schema DECLARATION is found through inline, local, named, default, namespace and barrel forms.
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { User } from './schemas/user'
import Settings from './schemas/user'
import * as q from './schemas/query'
import { BarrelUser } from './schemas'

const Local = z.object({ id: z.string() })

const app = new Hono()
app.post('/inline', zValidator('json', z.object({ x: z.number() })), (c) => c.json(c.req.valid('json')))
app.post('/local', zValidator('json', Local), (c) => c.json(c.req.valid('json')))
app.post('/named', zValidator('json', User), (c) => c.json(c.req.valid('json')))
app.post('/default', zValidator('json', Settings), (c) => c.json(c.req.valid('json')))
app.get('/namespace', zValidator('query', q.Paging), (c) => c.json(c.req.valid('query')))
app.post('/barrel', zValidator('json', BarrelUser), (c) => c.json(c.req.valid('json')))

export default app
