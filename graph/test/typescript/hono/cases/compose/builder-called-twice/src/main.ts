// census: app_factory_fn (violation hono-2-02, SPEC R6; oracle gap O9)
// One helper creates the root AND the sub-app: two apps, two route lists. The sub-app's route is mounted
// under a prefix known only at run time, so it is partial, never a root route.
import { makeApp } from './routes'
import { UserRoutes } from './users'

declare const process: { env: Record<string, string | undefined> }

const app = makeApp()
app.get('/logo.png', (c) => c.text('png'))
for (const group of [new UserRoutes()]) {
  app.route(group.prefix(process.env.API_VERSION ?? 'v1'), group.build())
}

export default app
