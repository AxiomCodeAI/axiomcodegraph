// census: zvalidator, validator_builtin, req_valid
// A validator argument is per-route middleware for that route.
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const NewPost = z.object({ title: z.string() })

const app = new Hono()
app.post('/posts', zValidator('json', NewPost), (c) => c.json(c.req.valid('json'), 201))
app.get(
  '/search',
  validator('query', (value) => value),
  (c) => c.text('search')
)

export default app
