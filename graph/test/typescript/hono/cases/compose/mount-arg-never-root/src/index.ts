// census: neg_route_on_nonhono, route_mount_literal (SPEC 2 [iter2]: a mount argument is never a root)
// `.route(p, B)` on a receiver that is not recognised as an app: B (a real Hono app) is not served bare; its
// route is partial with unresolved_mount. A `.route()` whose argument is not an app produces nothing.
import { Hono } from 'hono'

const reports = new Hono()
reports.get('/daily', (c) => c.text('daily'))

declare const registry: { route(prefix: string, app: unknown): void }
registry.route('/reports', reports)

const workflow = { route(name: string, step: () => void) { step() } }
workflow.route('/not-an-app', () => {})
