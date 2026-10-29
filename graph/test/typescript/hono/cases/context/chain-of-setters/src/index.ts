// census: ctx_set, ctx_get, verb_multi_handler
// Per-route middleware sets a key a later per-route middleware and the handler read.
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'

type Env = { Variables: { lang: string; greeting: string } }

const detectLang: MiddlewareHandler<Env> = async (c, next) => {
  c.set('lang', 'en')
  await next()
}
const greet: MiddlewareHandler<Env> = async (c, next) => {
  c.set('greeting', c.get('lang') === 'en' ? 'hello' : 'hallo')
  await next()
}

const app = new Hono<Env>()
app.get('/hello', detectLang, greet, (c) => c.text(`${c.var.greeting} (${c.get('lang')})`))

export default app
