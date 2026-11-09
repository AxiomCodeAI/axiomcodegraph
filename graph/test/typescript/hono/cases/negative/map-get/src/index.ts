// census: neg_map_get_in_hono_file (SPEC N1)
// get/set/use on Maps, a KV-like object and Headers, in the same file as a real app: only the app routes.
import { Hono } from 'hono'

const cache = new Map<string, string>()
cache.set('/users', 'cached')
cache.get('/users')

const kv = {
  get(key: string, onMiss: () => string) { return onMiss() },
  use(fn: () => void) { fn() },
}
kv.get('/kv/key', () => 'computed on miss')
kv.use(() => {})

const headers = new Headers()
headers.get('accept')

const app = new Hono()
app.get('/real', (c) => c.text(cache.get('/users') ?? ''))

export default app
