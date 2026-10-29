// census: export_default_fetch_obj, app_fetch_ref
// A Workers-style default export: fetch is the app; scheduled and queue are called by the platform.
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('worker'))

async function scheduled(event: unknown) {
  return event
}

export default {
  fetch: app.fetch,
  scheduled,
  async queue(batch: unknown) {
    return batch
  },
}
