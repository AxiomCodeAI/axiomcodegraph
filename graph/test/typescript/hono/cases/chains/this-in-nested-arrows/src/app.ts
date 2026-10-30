import { Hono } from 'hono'
import { Catalog, Resp } from './resp'

const app = new Hono()
const catalog = new Catalog()
app.get('/prices', (c) => c.json(catalog.prices()))
app.get('/taxes', (c) => c.json(catalog.taxes()))
app.get('/rounded', (c) => c.json(catalog.rounded()))
app.get('/later', async (c) => c.json(await catalog.later()))
app.get('/fail', (c) => c.json(Resp.fail([{ path: ['a', 'b'] }])))

export default app
