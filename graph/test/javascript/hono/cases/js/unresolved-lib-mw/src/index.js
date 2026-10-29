// census: builtin_mw_import (oracle gap O6: a library middleware whose package cannot be resolved)
// It is still a middleware node at its registering call, ahead of the project middleware, in its place.
import { Hono } from 'hono'
import { authSdk } from 'acme-auth-sdk'

const tag = async (c, next) => {
  await next()
}

const app = new Hono()
app.use(authSdk.middleware({ project: 'p' }))
app.use(tag)
app.get('/secure', (c) => c.text('secure'))

export default app
