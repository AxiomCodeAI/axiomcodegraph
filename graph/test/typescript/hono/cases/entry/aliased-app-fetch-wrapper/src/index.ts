// census: app_factory_fn, export_default_fetch_obj (oracle gap O4, SPEC R4)
// The app comes from a tsconfig-path-aliased module, and the default export is a custom object whose fetch
// forwards to the app's fetch: a served shape, and the forwarding call is no request of its own.
import { newApp } from '@/lib/app'

const app = newApp()
app.get('/aliased', (c) => c.text('aliased'))

export default {
  fetch(req: Request, env: unknown, ctx: any) {
    return app.fetch(req, env, ctx)
  },
}
