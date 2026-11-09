import { Hono } from 'hono'
import { mountPlugin } from './mount'
import { inboxPlugin } from './plugins/inbox'

declare const settings: { disabled: Set<string> }

const app = new Hono()
app.get('/', (c) => c.text('home'))
for (const p of [inboxPlugin].filter((x) => !settings.disabled.has(x.name))) {
  mountPlugin(app, p)
}

export default app
