// census: neg_map_get_in_hono_file, neg_route_on_nonhono (JavaScript)
// A Map, a cache object, and a router-shaped object beside one real app: only the app's route.
import { Hono } from 'hono'

const cache = new Map()
cache.set('/x', () => 'cached')
cache.get('/x')

const router = {
  get(path, fn) { return fn },
  use(fn) { return fn },
  route(path, other) { return other },
}
router.get('/not-hono', () => 'nope')
router.use(() => {})

const app = new Hono()
app.get('/real', (c) => c.text('real'))

export default app
