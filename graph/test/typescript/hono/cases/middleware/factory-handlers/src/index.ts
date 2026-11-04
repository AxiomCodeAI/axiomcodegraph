// census: create_factory, factory_create_app, create_middleware
// createFactory: initApp registrations run first on every app createApp makes; createHandlers spreads
// its arguments into the route (middleware then handler); factory.createMiddleware's arg is the middleware.
import { createFactory } from 'hono/factory'

const factory = createFactory({
  initApp: (app) => {
    app.use(async (c, next) => {
      await next()
    })
  },
})

const check = factory.createMiddleware(async (c, next) => {
  await next()
})
const handlers = factory.createHandlers(check, (c) => c.text('from createHandlers'))

const app = factory.createApp()
app.get('/factory', ...handlers)

export default app
