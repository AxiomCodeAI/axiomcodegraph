// census: route_mount_literal (oracle gap O11; SPEC 2 a mount argument is never a root)
// Plugins mounted in a loop inside a register(app) that nothing in the program calls: the plugin apps are
// mount arguments, so they are not roots; the receiver is a parameter typed Hono (prefix unknown).
import type { Hono } from 'hono'
import { plugins } from './plugins'

export function register(app: Hono) {
  for (const p of plugins) {
    app.route(p.prefix, p.app)
  }
}
