// census: workspace_subpath (SPEC R22a; violation hono-5-06's shape)
// The app imports `@acme/core/adapters`, a subpath the workspace package's `exports` does not list, under
// moduleResolution bundler. The TypeScript compiler enforces `exports` in this mode and refuses the import, so the
// binding is unknown: the mount is unresolved and nothing is served under /adapters. (The adapters module's own app,
// which nothing mounts, keeps the root row every never-mounted exported app gets; that is not R22a's to change.)
import { Hono } from 'hono'
// @ts-expect-error -- not exported by @acme/core under moduleResolution bundler (the compiler refuses it)
import { adapters } from '@acme/core/adapters'

const app = new Hono()
app.get('/health', (c) => c.text('ok'))
app.route('/adapters', adapters)

export default app
