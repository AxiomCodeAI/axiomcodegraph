// census: route_mount_root (SPEC R12.2: an opaque run-time module list)
// The server mounts `mod.default` for every file a directory listing finds at run time. A default-exported app that
// nothing imports, mounts or serves may be one of them: partial (unresolved_mount), never an exact root. The server's
// own app, an imported app and a separately served worker are unaffected.
import { Hono } from 'hono'
import shared from './shared'

declare function listRouteFiles(dir: string): Promise<string[]>

const app = new Hono()
app.route('/', shared)

export async function loadRoutes(dir: string) {
  for (const file of await listRouteFiles(dir)) {
    const mod = await import(file)
    app.route('/', mod.default)
  }
}

export default app
