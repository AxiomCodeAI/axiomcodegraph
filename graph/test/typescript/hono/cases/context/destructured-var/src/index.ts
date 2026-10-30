// census: ctx_set, ctx_get_destructured, factory_init_app
// A middleware installed by the factory sets two keys; one handler reads them by destructuring
// the context's variables, another by name.
import { createFactory } from 'hono/factory'

type Env = { Variables: { db: { url: string }; origin: string } }

const factory = createFactory<Env>({
  initApp: (app) => {
    app.use(async (c, next) => {
      c.set('db', { url: 'pg://local' })
      c.set('origin', 'https://example.test')
      await next()
    })
  },
})

const app = factory.createApp()
app.get('/both', (c) => {
  const { db, origin: from } = c.var
  return c.json({ url: db.url, from })
})
app.get('/one', (c) => c.text(c.var.origin))

export default app
