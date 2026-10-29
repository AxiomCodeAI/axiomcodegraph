import { Hono } from 'hono'
import { registerPlugins } from './plugins'
import { searchPlugin } from './plugins/search'
import { billingPlugin } from './plugins/billing'

const app = new Hono()
app.get('/', (c) => c.text('home'))
registerPlugins(app, [searchPlugin, billingPlugin])

export default app
