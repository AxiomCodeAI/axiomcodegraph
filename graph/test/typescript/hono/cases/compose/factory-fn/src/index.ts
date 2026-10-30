// census: app_factory_fn
// Apps produced by project factory functions (a factory calling a factory) are app values.
import { createApp, createRouter } from './app'

const app = createApp()
const items = createRouter()
items.get('/', (c) => c.json([]))
app.route('/items', items)

export default app
